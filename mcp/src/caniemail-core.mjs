/**
 * caniemail-ai-tooling — shared core.
 *
 * The single implementation behind both surfaces (skill and MCP server).
 * Vendored byte-identically into `skill/scripts/` and `mcp/src/`; never edit a
 * vendored copy, edit this file and run `make sync-core`.
 *
 * Plain ESM with JSDoc types rather than TypeScript, so the vendored copies
 * need no build step on either surface. There are no runtime dependencies at
 * all: Node 22+ and nothing else. Detection lives in `detect.mjs` and the
 * scanners beside it; resolution lives here.
 *
 * Detection and resolution are kept apart on purpose. "What does this markup
 * use?" is a question about the markup, and "how well does client X support
 * it?" a question about the dataset; answering the first in terms of the
 * second is what made the previous implementation need 48 parses to see one
 * document, and what made 22 features undetectable however many it ran.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

import { detectFeatures } from './detect.mjs';
import bundledData from './data/caniemail.json' with { type: 'json' };

export const DATA_URL = 'https://www.caniemail.com/api/data.json';

/**
 * The four verdicts caniemail's dataset actually distinguishes.
 *
 * `caniemail`'s own API collapses `a` and `u` into a single `partial` bucket,
 * which destroys the distinction between "works with a documented workaround"
 * and "nobody has ever tested this". Those demand opposite actions from an
 * agent, so they stay separate here.
 *
 * @typedef {'supported'|'unsupported'|'mitigated'|'untested'} Verdict
 */
export const SUPPORTED = 'supported';
export const UNSUPPORTED = 'unsupported';
export const MITIGATED = 'mitigated';
export const UNTESTED = 'untested';

/** Raw dataset letter -> verdict. Anything unrecognised is treated as untested. */
const VERDICT_BY_LETTER = { y: SUPPORTED, n: UNSUPPORTED, a: MITIGATED, u: UNTESTED };

/* Detection strategy is documented on `detectFeatures`, near its use. */

/* -------------------------------------------------------------------------- */
/* Dataset loading                                                             */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {object} Dataset
 * @property {object[]} features       Raw feature records, as authored upstream.
 * @property {string[]} clients        `family.platform` ids derived from the data.
 * @property {Map<string, object>} bySlug
 * @property {Map<string, object>} byTitle
 * @property {object} nicenames
 * @property {DatasetMeta} meta
 */

/**
 * @typedef {object} DatasetMeta
 * @property {'live'|'cache'|'bundled'} source
 * @property {string} lastUpdate      Upstream `last_update_date`.
 * @property {string|null} fetchedAt  ISO time this copy was retrieved, if known.
 * @property {number} featureCount
 * @property {string|null} warning    Set when the copy in use is not the live one.
 */

function defaultCacheDir() {
  const xdg = process.env.XDG_CACHE_HOME;
  if (xdg) return join(xdg, 'caniemail-ai-tooling');
  try {
    return join(homedir(), '.cache', 'caniemail-ai-tooling');
  } catch {
    return join(tmpdir(), 'caniemail-ai-tooling');
  }
}

function indexDataset(raw, meta) {
  const features = raw.data ?? [];

  // The client roster is derived from the data rather than hardcoded or read
  // out of the package's internals, which its export map blocks anyway. The
  // two agree exactly today (48 clients), and deriving means a client added
  // upstream appears here without a release.
  const clients = new Set();
  for (const feature of features) {
    for (const family of Object.keys(feature.stats ?? {})) {
      for (const platform of Object.keys(feature.stats[family] ?? {})) {
        clients.add(`${family}.${platform}`);
      }
    }
  }

  return {
    features,
    clients: [...clients].sort(),
    bySlug: new Map(features.map((f) => [f.slug, f])),
    byTitle: new Map(features.map((f) => [f.title, f])),
    nicenames: raw.nicenames ?? {},
    meta: { ...meta, lastUpdate: raw.last_update_date, featureCount: features.length },
  };
}

/**
 * Load the caniemail dataset, preferring live data over the bundled snapshot.
 *
 * The snapshot in `data/caniemail.json` is committed to this repo and refreshed
 * with `make refresh-data`. It exists so that a skill copied to a machine with
 * no network still answers, and so the test suite is deterministic — both of
 * which the `caniemail` package used to provide for free, and neither of which
 * survived removing it.
 *
 * We fetch live, cache to disk, and fall back to the snapshot so the tools
 * never hard-fail offline. `meta.source` and `meta.warning` always say which
 * copy is in play, so a stale answer is visibly stale rather than silently
 * wrong.
 *
 * @param {object} [options]
 * @param {string} [options.cacheDir]
 * @param {number} [options.maxAgeMs]  Refetch if the cache is older than this.
 * @param {boolean} [options.offline]  Skip the network entirely.
 * @param {number} [options.timeoutMs]
 * @returns {Promise<Dataset>}
 */
export async function loadDataset(options = {}) {
  const {
    cacheDir = defaultCacheDir(),
    maxAgeMs = 24 * 60 * 60 * 1000,
    offline = false,
    timeoutMs = 10_000,
  } = options;

  const cacheFile = join(cacheDir, 'data.json');

  if (!offline) {
    // A fresh cache short-circuits the fetch; anything else re-checks the network.
    try {
      if (existsSync(cacheFile)) {
        const cached = JSON.parse(await readFile(cacheFile, 'utf8'));
        const age = Date.now() - Date.parse(cached.fetchedAt);
        if (Number.isFinite(age) && age < maxAgeMs) {
          return indexDataset(cached.raw, { source: 'cache', fetchedAt: cached.fetchedAt, warning: null });
        }
      }
    } catch {
      // Corrupt cache is not an error condition; fall through and refetch.
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(DATA_URL, { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw = await response.json();
      const fetchedAt = new Date().toISOString();
      try {
        await mkdir(cacheDir, { recursive: true });
        await writeFile(cacheFile, JSON.stringify({ fetchedAt, raw }));
      } catch {
        // An unwritable cache degrades performance, not correctness.
      }
      return indexDataset(raw, { source: 'live', fetchedAt, warning: null });
    } catch {
      // Fall through to cache-then-bundle.
    }

    try {
      if (existsSync(cacheFile)) {
        const cached = JSON.parse(await readFile(cacheFile, 'utf8'));
        return indexDataset(cached.raw, {
          source: 'cache',
          fetchedAt: cached.fetchedAt,
          warning: 'Live fetch failed; using cached data, which may be out of date.',
        });
      }
    } catch {
      // Fall through to the bundle.
    }
  }

  return indexDataset(bundledData, {
    source: 'bundled',
    fetchedAt: null,
    warning: offline
      ? 'Offline mode: using the dataset snapshot bundled with this tool, which lags the site.'
      : 'Live fetch and cache both unavailable; using the dataset snapshot bundled with this tool, which lags the site.',
  });
}

/* -------------------------------------------------------------------------- */
/* Client globs                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Expand `family.platform` globs against the known client list.
 *
 * Deliberately reimplemented rather than delegating to the package's
 * micromatch-based `parseClients`, so that an unmatched glob is an explicit
 * error instead of a silently empty result — an agent that typos
 * `outlook.win` should be told, not handed a clean bill of health.
 *
 * @param {Dataset} dataset
 * @param {string[]} globs
 * @returns {string[]} Matching client ids, sorted and deduplicated.
 */
export function expandClients(dataset, globs) {
  if (!Array.isArray(globs) || globs.length === 0) {
    throw new Error('At least one client or glob is required. Use ["*"] for all clients.');
  }
  const matched = new Set();
  const unmatched = [];
  for (const glob of globs) {
    const text = String(glob);
    // A bare "*" means every client. Elsewhere a wildcard is confined to one
    // segment, so "outlook.*" cannot reach across the dot into another family.
    const pattern =
      text === '*'
        ? /^.+$/
        : new RegExp(`^${text.split('*').map(escapeRegExp).join('[^.]*')}$`);
    const hits = dataset.clients.filter((client) => pattern.test(client));
    if (hits.length === 0) unmatched.push(glob);
    for (const hit of hits) matched.add(hit);
  }
  if (unmatched.length > 0) {
    throw new Error(
      `No client matches: ${unmatched.join(', ')}. ` +
        `Clients are "family.platform", e.g. outlook.windows, gmail.desktop-webmail. ` +
        `Use listClients() for the full list.`,
    );
  }
  return [...matched].sort();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The full client roster, with human-readable names.
 * @param {Dataset} dataset
 */
export function listClients(dataset) {
  const family = dataset.nicenames?.family ?? {};
  const platform = dataset.nicenames?.platform ?? {};
  return dataset.clients.map((client) => {
    const [fam, plat] = client.split('.');
    return { client, family: family[fam] ?? fam, platform: platform[plat] ?? plat };
  });
}

/* -------------------------------------------------------------------------- */
/* Support resolution                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Resolve one feature's support in one client.
 *
 * Version selection takes the **last key as authored**, and does not sort.
 * This is the whole correctness argument, so it is worth stating plainly: the
 * upstream JSON preserves the order the site itself displays, which is
 * chronological by construction, and any re-sort corrupts it. A lexicographic
 * sort mis-picks 280 cells and a numeric sort 264 — `outlook.macos` carries
 * `["2011", "2016", "16.80"]`, where the newest entry sorts smallest under
 * both. The package sorts lexicographically and inherits every one of those.
 *
 * @param {object} feature Raw feature record.
 * @param {string} client  `family.platform`.
 * @param {object} [options]
 * @param {string} [options.version] Pin a specific version instead of the latest.
 * @returns {{verdict: Verdict, version: string|null, raw: string|null, notes: string[]}}
 */
export function resolveSupport(feature, client, options = {}) {
  const [family, platform] = client.split('.');
  const versions = feature?.stats?.[family]?.[platform];

  // No entry at all is untested, not unsupported. 16% of pairs land here, and
  // this is precisely where the package throws instead of answering.
  if (!versions || typeof versions !== 'object') {
    return { verdict: UNTESTED, version: null, raw: null, notes: [] };
  }

  const keys = Object.keys(versions);
  if (keys.length === 0) return { verdict: UNTESTED, version: null, raw: null, notes: [] };

  let version;
  if (options.version) {
    if (!Object.hasOwn(versions, options.version)) {
      const available = keys.join(', ');
      throw new Error(
        `No data for ${client} version "${options.version}". Available: ${available}.`,
      );
    }
    version = options.version;
  } else {
    version = keys[keys.length - 1];
  }

  const raw = String(versions[version]);
  const letter = raw.trim()[0];
  const verdict = VERDICT_BY_LETTER[letter] ?? UNTESTED;

  return { verdict, version, raw, notes: notesFor(feature, raw) };
}

/**
 * Resolve `#1 #2` note references against the feature's `notes_by_num` map.
 *
 * Only the notes this cell actually references. The feature-level `notes`
 * field is deliberately excluded: it is a general remark about the feature,
 * often describing one specific client, and attaching it to every verdict
 * produces contradictions — `css-gap` is unsupported in Outlook but its global
 * note reads "Partial. Supports column-gap for flexbox", which is about Gmail.
 * An error that carries a note describing partial support is worse than no
 * note. It is surfaced separately as `feature_notes`.
 */
function notesFor(feature, raw) {
  const notes = [];
  for (const match of String(raw).matchAll(/#(\d+)/g)) {
    const note = feature?.notes_by_num?.[match[1]];
    if (note) notes.push(note);
  }
  return notes;
}

/** The feature-level remark, which applies to the feature rather than any one client. */
function featureNotes(feature) {
  return feature?.notes ? String(feature.notes).trim() : null;
}

/** The version keys on record for a client, in authored order. */
export function versionsFor(feature, client) {
  const [family, platform] = client.split('.');
  const versions = feature?.stats?.[family]?.[platform];
  return versions ? Object.keys(versions) : [];
}

/* -------------------------------------------------------------------------- */
/* Tool: check_feature_support                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Per-client verdicts for one feature.
 *
 * @param {Dataset} dataset
 * @param {string} slug    Feature slug, e.g. `css-flexbox`.
 * @param {string[]} clientGlobs
 * @param {object} [options]
 * @param {string} [options.version]
 */
export function checkFeatureSupport(dataset, slug, clientGlobs, options = {}) {
  const feature = dataset.bySlug.get(slug);
  if (!feature) {
    throw new Error(`Unknown feature "${slug}". Use search_features to find the right slug.`);
  }
  const clients = expandClients(dataset, clientGlobs);

  const support = clients.map((client) => {
    const resolved = resolveSupport(feature, client, options);
    return {
      client,
      verdict: resolved.verdict,
      version: resolved.version,
      notes: resolved.notes,
      versions_on_record: versionsFor(feature, client),
    };
  });

  return {
    slug: feature.slug,
    title: feature.title,
    description: feature.description,
    category: feature.category,
    url: feature.url,
    last_test_date: feature.last_test_date,
    staleness: stalenessOf(feature.last_test_date),
    feature_notes: featureNotes(feature),
    summary: summarise(support),
    support,
    data_source: dataset.meta,
  };
}

function summarise(support) {
  const counts = { supported: 0, unsupported: 0, mitigated: 0, untested: 0 };
  for (const entry of support) counts[entry.verdict] += 1;
  return counts;
}

/**
 * How old a feature's last test is.
 *
 * Freshness is uneven across the dataset — some entries have not been retested
 * in years — and an agent should be able to see that rather than infer it.
 */
function stalenessOf(lastTestDate) {
  if (!lastTestDate) return { years_old: null, note: 'No test date on record.' };
  const then = Date.parse(lastTestDate);
  if (!Number.isFinite(then)) return { years_old: null, note: 'Unparseable test date.' };
  const years = (Date.now() - then) / (365.25 * 24 * 60 * 60 * 1000);
  const rounded = Math.round(years * 10) / 10;
  return {
    years_old: rounded,
    note:
      rounded >= 3
        ? `Last tested ${rounded} years ago; treat with caution and re-verify if it matters.`
        : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Tool: search_features                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Find feature slugs by keyword.
 *
 * Agents do not know that flexbox lives at `css-flexbox` or that "rounded
 * corners" is `css-border-radius`, so without this the lookup tool is
 * unusable. Returns identifiers and one-line descriptions only — never stats —
 * to keep the result small enough to call speculatively.
 *
 * @param {Dataset} dataset
 * @param {string} query
 * @param {object} [options]
 * @param {number} [options.limit]
 * @param {string} [options.category] One of html, css, image, others.
 */
export function searchFeatures(dataset, query, options = {}) {
  const { limit = 15, category } = options;
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) throw new Error('A search query is required.');

  const terms = needle.split(/\s+/);
  const scored = [];

  for (const feature of dataset.features) {
    if (category && feature.category !== category) continue;

    const keywordList = (feature.keywords ?? '')
      .toLowerCase()
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);

    const haystacks = {
      slug: (feature.slug ?? '').toLowerCase(),
      title: (feature.title ?? '').toLowerCase(),
      keywords: keywordList.join(' '),
      description: (feature.description ?? '').toLowerCase(),
      tags: (feature.tags ?? []).join(' ').toLowerCase(),
    };

    let score = 0;

    // Weighted by how deliberate the match is: an exact slug hit beats a stray
    // word in a description by two orders of magnitude.
    if (haystacks.slug === needle) score += 1000;
    if (haystacks.title === needle) score += 500;

    let matchedTerms = 0;
    for (const term of terms) {
      let termScore = 0;
      if (haystacks.slug.includes(term)) termScore += 60;
      if (haystacks.title.includes(term)) termScore += 50;
      if (keywordList.includes(term)) {
        // An exact keyword, weighted by how much of the feature's keyword set
        // it accounts for. "flexbox" is the only keyword on css-display-flex
        // but one of four on css-align-items, so the former is more on-topic.
        termScore += 30 + Math.round(30 / keywordList.length);
      } else if (haystacks.keywords.includes(term)) {
        termScore += 15;
      }
      if (haystacks.tags.includes(term)) termScore += 15;
      if (haystacks.description.includes(term)) termScore += 5;

      if (termScore > 0) matchedTerms += 1;
      score += termScore;
    }

    // Covering more of the query outranks matching one term loudly. Without
    // this, "rounded corners" puts a font feature whose title contains
    // "ui-rounded" above border-radius, which matches both words.
    score += matchedTerms * 100;

    if (matchedTerms > 0) scored.push({ feature, score });
  }

  scored.sort((a, b) => b.score - a.score || a.feature.slug.localeCompare(b.feature.slug));

  return {
    query,
    match_count: scored.length,
    results: scored.slice(0, limit).map(({ feature }) => ({
      slug: feature.slug,
      title: feature.title,
      category: feature.category,
      description: feature.description,
      url: feature.url,
      last_test_date: feature.last_test_date,
    })),
    data_source: dataset.meta,
  };
}

/* -------------------------------------------------------------------------- */
/* Tool: lint_email                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Lint an email's HTML and/or CSS against a set of clients.
 *
 * Returns only problems — never the passing features — so the result stays
 * small enough to hand back to an agent mid-draft.
 *
 * @param {Dataset} dataset
 * @param {object} options
 * @param {string} [options.html]
 * @param {string} [options.css]
 * @param {string[]} options.clients
 * @param {boolean} [options.includeUntested] Report untested features too (default true).
 */
export function lintEmail(dataset, options) {
  const { html, css, clients: clientGlobs, includeUntested = true } = options ?? {};
  if (!html && !css) throw new Error('Provide html, css, or both.');

  const clients = expandClients(dataset, clientGlobs);
  const detected = detectFeatures(dataset, { html, css });

  const findings = [];
  for (const { title, position } of detected.values()) {
    const feature = dataset.byTitle.get(title);
    if (!feature) continue; // Detected something the dataset no longer describes.

    // Notes accumulate per verdict bucket, never across the whole feature.
    // Sharing one note set between buckets leaks a note describing partial
    // support in one client onto another client's hard failure — `css-gap` is
    // unsupported in Outlook, and Gmail's "Partial. Supports column-gap"
    // annotation must not travel with the Outlook error.
    const buckets = {
      [UNSUPPORTED]: { clients: [], notes: new Set() },
      [MITIGATED]: { clients: [], notes: new Set() },
      [UNTESTED]: { clients: [], notes: new Set() },
    };

    for (const client of clients) {
      const resolved = resolveSupport(feature, client);
      if (resolved.verdict === SUPPORTED) continue;
      const bucket = buckets[resolved.verdict];
      bucket.clients.push(client);
      for (const note of resolved.notes) bucket.notes.add(note);
    }

    for (const [verdict, bucket] of Object.entries(buckets)) {
      const affected = bucket.clients;
      if (affected.length === 0) continue;
      if (verdict === UNTESTED && !includeUntested) continue;
      findings.push({
        feature: feature.slug,
        title: feature.title,
        severity: SEVERITY_BY_VERDICT[verdict],
        verdict,
        clients_affected: affected,
        client_count: affected.length,
        notes: verdict === UNTESTED ? [] : [...bucket.notes],
        feature_notes: verdict === UNTESTED ? null : featureNotes(feature),
        position: position ?? null,
        url: feature.url,
        last_test_date: feature.last_test_date,
        guidance: GUIDANCE_BY_VERDICT[verdict],
      });
    }
  }

  // Hard failures first, then breadth of impact — an agent reading top-down
  // fixes the most damaging thing first.
  const order = { error: 0, warning: 1, unknown: 2 };
  findings.sort(
    (a, b) => order[a.severity] - order[b.severity] || b.client_count - a.client_count,
  );

  const counts = { error: 0, warning: 0, unknown: 0 };
  for (const finding of findings) counts[finding.severity] += 1;

  return {
    clients_checked: clients,
    findings,
    summary: { ...counts, total: findings.length },
    passed: counts.error === 0,
    data_source: dataset.meta,
  };
}

const SEVERITY_BY_VERDICT = {
  [UNSUPPORTED]: 'error',
  [MITIGATED]: 'warning',
  [UNTESTED]: 'unknown',
};

const GUIDANCE_BY_VERDICT = {
  [UNSUPPORTED]: 'Not supported. This will not render as intended; use a fallback.',
  [MITIGATED]: 'Partial or conditional support. Read the notes — usually workable with a documented workaround.',
  [UNTESTED]: 'Never tested on these clients. Not evidence of support either way; avoid, or test it yourself.',
};
