/**
 * Tests for the shared core.
 *
 * These run offline against the dataset snapshot in `data/caniemail.json`, so
 * they are deterministic and safe for CI. Network-dependent behaviour is gated
 * behind CANIEMAIL_TEST_NETWORK=1.
 *
 * Much of this file is regression coverage for defects in the `caniemail`
 * package this core replaced. Those tests are written against *our* behaviour,
 * not the package's, so they keep passing if upstream is fixed — and they fail
 * loudly if a refactor ever starts delegating resolution away again.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MITIGATED,
  SUPPORTED,
  UNSUPPORTED,
  UNTESTED,
  checkFeatureSupport,
  expandClients,
  lintEmail,
  listClients,
  loadDataset,
  resolveSupport,
  searchFeatures,
  versionsFor,
} from './caniemail-core.mjs';

const dataset = await loadDataset({ offline: true });

/* -------------------------------------------------------------------------- */
/* Dataset loading                                                             */
/* -------------------------------------------------------------------------- */

test('offline load falls back to the bundled dataset and says so', () => {
  assert.equal(dataset.meta.source, 'bundled');
  assert.match(dataset.meta.warning, /bundled/);
  assert.ok(dataset.features.length > 250);
});

test('client roster is derived from the data', () => {
  assert.equal(dataset.clients.length, 48);
  assert.ok(dataset.clients.includes('outlook.windows'));
  assert.ok(dataset.clients.includes('gmail.desktop-webmail'));
  // Every id is family.platform, with exactly one separator.
  for (const client of dataset.clients) {
    assert.equal(client.split('.').length, 2, `malformed client id: ${client}`);
  }
});

test('listClients resolves human-readable names', () => {
  const clients = listClients(dataset);
  const outlook = clients.find((c) => c.client === 'outlook.windows');
  assert.equal(outlook.family, 'Outlook');
  assert.equal(outlook.platform, 'Windows');
});

/* -------------------------------------------------------------------------- */
/* Regression: untested must not collapse into mitigated                       */
/* -------------------------------------------------------------------------- */

test('regression: "u" resolves to untested, not mitigated', () => {
  // The package's getSupportType returns 'partial' for anything that is not
  // y or n, merging `a` (works with a workaround) into `u` (never tested).
  // 900 of its 1,637 partial verdicts are actually untested.
  const feature = { stats: { gmail: { 'desktop-webmail': { '2024-01': 'u' } } } };
  const resolved = resolveSupport(feature, 'gmail.desktop-webmail');
  assert.equal(resolved.verdict, UNTESTED);
  assert.notEqual(resolved.verdict, MITIGATED);
});

test('regression: "a" resolves to mitigated and keeps its notes', () => {
  const feature = {
    stats: { outlook: { windows: { 2019: 'a #1' } } },
    notes_by_num: { 1: 'Only works with inline styles.' },
  };
  const resolved = resolveSupport(feature, 'outlook.windows');
  assert.equal(resolved.verdict, MITIGATED);
  assert.deepEqual(resolved.notes, ['Only works with inline styles.']);
});

test('the four verdicts are all reachable and distinct', () => {
  const build = (value) => ({ stats: { gmail: { 'desktop-webmail': { '2024-01': value } } } });
  const verdicts = ['y', 'n', 'a', 'u'].map(
    (letter) => resolveSupport(build(letter), 'gmail.desktop-webmail').verdict,
  );
  assert.deepEqual(verdicts, [SUPPORTED, UNSUPPORTED, MITIGATED, UNTESTED]);
});

/* -------------------------------------------------------------------------- */
/* Regression: version selection must not sort                                 */
/* -------------------------------------------------------------------------- */

test('regression: latest version is the last authored key, not the sorted one', () => {
  // outlook.macos genuinely carries these three keys in this order. "16.80"
  // (new Outlook for Mac) is newest, but sorts smallest both lexicographically
  // and numerically. Sorting picks 2016 and reports the wrong verdict.
  const feature = {
    stats: { outlook: { macos: { 2011: 'n', 2016: 'n', '16.80': 'y' } } },
  };
  const resolved = resolveSupport(feature, 'outlook.macos');
  assert.equal(resolved.version, '16.80');
  assert.equal(resolved.verdict, SUPPORTED);
});

test('regression: date-stamped keys after semver keys still resolve to the last', () => {
  // samsung-email.android mixes formats: ["5.0.10.2", "2024-10"].
  const feature = {
    stats: { 'samsung-email': { android: { '5.0.10.2': 'y', '2024-10': 'a' } } },
  };
  assert.equal(resolveSupport(feature, 'samsung-email.android').version, '2024-10');
});

test('a version can be pinned explicitly', () => {
  const feature = { stats: { outlook: { windows: { 2016: 'n', 2019: 'y' } } } };
  assert.equal(resolveSupport(feature, 'outlook.windows', { version: '2016' }).verdict, UNSUPPORTED);
  assert.equal(resolveSupport(feature, 'outlook.windows').verdict, SUPPORTED);
});

test('pinning an unknown version reports what is available', () => {
  const feature = { stats: { outlook: { windows: { 2016: 'n', 2019: 'y' } } } };
  assert.throws(
    () => resolveSupport(feature, 'outlook.windows', { version: '2013' }),
    /No data for outlook\.windows version "2013".*2016, 2019/s,
  );
});

test('versionsFor reports keys in authored order', () => {
  const feature = { stats: { outlook: { macos: { 2011: 'n', 2016: 'n', '16.80': 'y' } } } };
  assert.deepEqual(versionsFor(feature, 'outlook.macos'), ['2011', '2016', '16.80']);
  assert.deepEqual(versionsFor(feature, 'gmail.android'), []);
});

/* -------------------------------------------------------------------------- */
/* Regression: missing data is untested, not an exception                      */
/* -------------------------------------------------------------------------- */

test('regression: a missing stats entry is untested, not a throw', () => {
  // The package raises RangeError here. 16% of (feature, client) pairs have no
  // entry, so this is the common case, not an edge case.
  const feature = { stats: { gmail: { 'desktop-webmail': { '2024-01': 'y' } } } };
  const resolved = resolveSupport(feature, 'thunderbird.windows');
  assert.equal(resolved.verdict, UNTESTED);
  assert.equal(resolved.version, null);
  assert.deepEqual(resolved.notes, []);
});

test('regression: clients that crash the package still lint', () => {
  // These seven throw inside caniemail() on markup as plain as a <div>.
  const crashers = [
    'free-fr.desktop-webmail',
    'laposte.android',
    'laposte.ios',
    'rainloop.desktop-webmail',
    't-online-de.desktop-webmail',
    'thunderbird.windows',
    'wp-pl.desktop-webmail',
  ];
  const result = lintEmail(dataset, {
    html: '<div style="display:flex"><p>hi</p></div>',
    clients: crashers,
  });
  assert.deepEqual(result.clients_checked, [...crashers].sort());
  assert.ok(Array.isArray(result.findings));
});

test('regression: the "*" glob works end to end', () => {
  // caniemail({clients:['*']}) throws unconditionally. Ours must not.
  const result = lintEmail(dataset, {
    html: '<div style="display:flex">hi</div>',
    clients: ['*'],
  });
  assert.equal(result.clients_checked.length, 48);
  assert.ok(result.findings.length > 0);
});

/* -------------------------------------------------------------------------- */
/* Client globs                                                                */
/* -------------------------------------------------------------------------- */

test('globs expand on both sides of the dot', () => {
  assert.deepEqual(expandClients(dataset, ['outlook.windows']), ['outlook.windows']);
  const outlook = expandClients(dataset, ['outlook.*']);
  assert.ok(outlook.length >= 6);
  assert.ok(outlook.every((c) => c.startsWith('outlook.')));
  const ios = expandClients(dataset, ['*.ios']);
  assert.ok(ios.every((c) => c.endsWith('.ios')));
  assert.equal(expandClients(dataset, ['*']).length, 48);
});

test('a glob matching nothing is an error, not an empty pass', () => {
  // Silently returning [] would hand an agent a clean bill of health for a typo.
  assert.throws(() => expandClients(dataset, ['outlook.win']), /No client matches: outlook\.win/);
  assert.throws(() => expandClients(dataset, []), /At least one client/);
});

test('a wildcard does not leak across the dot separator', () => {
  // "outlook.*" must not match "outlook.windows.foo"-style ids, and "*" as a
  // family must not swallow the platform segment.
  const families = expandClients(dataset, ['gmail.*']);
  assert.ok(families.every((c) => c.split('.').length === 2));
});

/* -------------------------------------------------------------------------- */
/* search_features                                                             */
/* -------------------------------------------------------------------------- */

test('search finds features by common name', () => {
  const flex = searchFeatures(dataset, 'flexbox');
  assert.equal(flex.results[0].slug, 'css-display-flex');

  const rounded = searchFeatures(dataset, 'border-radius');
  assert.ok(rounded.results.some((r) => r.slug === 'css-border-radius'));
});

test('search ranks by query coverage, not by one loud match', () => {
  // "ui-rounded" appears in the system-ui feature's title and would outrank
  // border-radius on raw field weight alone; matching both query words wins.
  const result = searchFeatures(dataset, 'rounded corners');
  assert.equal(result.results[0].slug, 'css-border-radius');
});

test('search prefers the feature a keyword is most specific to', () => {
  // "flexbox" is the sole keyword on css-display-flex and one of four on
  // css-align-items, so it is more on-topic for a bare "flexbox" query.
  const result = searchFeatures(dataset, 'flexbox');
  assert.equal(result.results[0].slug, 'css-display-flex');
});

test('search returns identifiers only, never stats', () => {
  const result = searchFeatures(dataset, 'flex');
  for (const hit of result.results) {
    assert.ok(hit.slug && hit.title && hit.url);
    assert.equal(hit.stats, undefined, 'search must not carry the support matrix');
  }
});

test('search respects limit and category', () => {
  assert.ok(searchFeatures(dataset, 'css', { limit: 3 }).results.length <= 3);
  const html = searchFeatures(dataset, 'element', { category: 'html', limit: 50 });
  assert.ok(html.results.length > 0);
  assert.ok(html.results.every((r) => r.category === 'html'));
});

test('search requires a query', () => {
  assert.throws(() => searchFeatures(dataset, '   '), /query is required/);
});

/* -------------------------------------------------------------------------- */
/* check_feature_support                                                       */
/* -------------------------------------------------------------------------- */

test('check_feature_support gives a per-client verdict', () => {
  const result = checkFeatureSupport(dataset, 'css-display-flex', ['outlook.windows', 'gmail.*']);
  assert.equal(result.slug, 'css-display-flex');
  assert.ok(result.url.startsWith('https://'));

  const outlook = result.support.find((s) => s.client === 'outlook.windows');
  assert.equal(outlook.verdict, UNSUPPORTED);
  assert.ok(outlook.versions_on_record.length > 0);

  const total = Object.values(result.summary).reduce((a, b) => a + b, 0);
  assert.equal(total, result.support.length);
});

test('check_feature_support surfaces test-date staleness', () => {
  const result = checkFeatureSupport(dataset, 'amp', ['gmail.desktop-webmail']);
  // The AMP entry was last tested in 2020 and is well past the caution
  // threshold; the agent should be told rather than left to infer it.
  assert.ok(result.staleness.years_old > 3);
  assert.match(result.staleness.note, /re-verify/);
});

test('an unknown slug points at the search tool', () => {
  assert.throws(() => checkFeatureSupport(dataset, 'css-flexbocks', ['*']), /search_features/);
});

test('a version pin resolves per client instead of failing the whole glob', () => {
  // "Does this work in Outlook 2016" spelled the way anyone would spell it.
  // Fanning `resolveSupport`'s throw across a glob made this fail on the first
  // sibling that versions itself by date — naming a client nobody asked about.
  const result = checkFeatureSupport(dataset, 'css-border-radius', ['outlook.*'], {
    version: '2016',
  });
  assert.equal(result.version_requested, '2016');

  const pinned = result.support.filter((s) => s.version === '2016');
  assert.ok(pinned.length > 0, 'expected at least one Outlook client to carry a 2016 entry');

  for (const entry of result.support) {
    if (entry.versions_on_record.includes('2016')) {
      assert.equal(entry.version, '2016');
      continue;
    }
    // No data for the version asked about is untested — not unsupported, and
    // not a silent fallback to some other version's verdict.
    assert.equal(entry.verdict, UNTESTED);
    assert.equal(entry.version, null);
    assert.equal(entry.version_requested, '2016');
    assert.deepEqual(entry.notes, [], 'an untested verdict has no findings to report');
  }
});

test('a version pin no requested client carries is still an error', () => {
  // The per-client fallback must not swallow a typo into 48 untested verdicts.
  assert.throws(
    () => checkFeatureSupport(dataset, 'css-border-radius', ['outlook.*'], { version: '2015' }),
    /No data for outlook\.[\w-]+ version "2015"/,
  );
});

/* -------------------------------------------------------------------------- */
/* lint_email                                                                  */
/* -------------------------------------------------------------------------- */

test('lint reports failures with position, notes and url', () => {
  const result = lintEmail(dataset, {
    html: '<div style="display:flex; border-radius:8px">hi</div>',
    clients: ['outlook.windows'],
  });

  const flex = result.findings.find((f) => f.feature === 'css-display-flex');
  assert.ok(flex, 'expected display:flex to be flagged on outlook.windows');
  assert.equal(flex.severity, 'error');
  assert.equal(flex.verdict, UNSUPPORTED);
  assert.deepEqual(flex.clients_affected, ['outlook.windows']);
  assert.ok(flex.url.startsWith('https://'));
  assert.match(flex.positions[0], /^\d+:\d+-\d+:\d+$/);
  assert.equal(flex.occurrence_count, 1);

  const radius = result.findings.find((f) => f.feature === 'css-border-radius');
  assert.ok(radius.notes.some((n) => /VML|RoundRect/i.test(n)), 'expected the VML workaround note');
});

test('per-client notes never contradict the verdict they attach to', () => {
  // css-gap is flatly unsupported in Outlook Windows, but Gmail's cell carries
  // "Partial. Supports column-gap for flexbox". Accumulating notes per feature
  // rather than per verdict leaks that annotation onto the Outlook error,
  // producing a hard failure that reads as partial support.
  const result = lintEmail(dataset, {
    html: '<div style="display:flex; gap:16px">hi</div>',
    clients: ['outlook.windows', 'gmail.desktop-webmail'],
  });
  const findings = result.findings.filter((f) => f.feature === 'css-gap');
  assert.ok(findings.length >= 2, 'expected gap to split across verdicts');

  const outlook = findings.find((f) => f.clients_affected.includes('outlook.windows'));
  assert.equal(outlook.verdict, UNSUPPORTED);
  assert.deepEqual(outlook.notes, [], 'the Outlook error must not carry Gmail’s partial-support note');

  const gmail = findings.find((f) => f.clients_affected.includes('gmail.desktop-webmail'));
  assert.equal(gmail.verdict, MITIGATED);
  assert.ok(gmail.notes.some((n) => /column-gap/.test(n)), 'Gmail keeps its own note');
});

test('every occurrence of a feature is reported, not just the first', () => {
  // Detection used to keep only the earliest sighting per title, so an email
  // using border-radius twelve times produced one finding pointing at the
  // first — leaving an agent that fixed it with no signal the others existed.
  const html = [
    '<div style="border-radius:4px">a</div>',
    '<div style="border-radius:8px">b</div>',
    '<div style="border-radius:9px">c</div>',
  ].join('\n');
  const result = lintEmail(dataset, { html, clients: ['outlook.windows'] });

  const radius = result.findings.find((f) => f.feature === 'css-border-radius');
  assert.equal(radius.occurrence_count, 3);
  assert.equal(radius.positions.length, 3);
  assert.deepEqual(
    radius.positions.map((p) => Number(p.split(':')[0])),
    [1, 2, 3],
    'positions are in document order, earliest first',
  );
});

test('the position list is capped but the occurrence count is not', () => {
  // A generated email can repeat one declaration hundreds of times; the count
  // stays truthful while the list stays bounded, and their disagreement is the
  // signal that there are more.
  const html = Array.from(
    { length: 25 },
    (_, i) => `<div style="border-radius:${i}px">x</div>`,
  ).join('\n');
  const result = lintEmail(dataset, { html, clients: ['outlook.windows'] });

  const radius = result.findings.find((f) => f.feature === 'css-border-radius');
  assert.equal(radius.occurrence_count, 25);
  assert.equal(radius.positions.length, 10);
  assert.match(radius.positions[0], /^1:/, 'the cap drops the latest, never the earliest');
});

test('lint never reports passing features', () => {
  const result = lintEmail(dataset, {
    html: '<div style="color:red">hi</div>',
    clients: ['*'],
  });
  for (const finding of result.findings) {
    assert.notEqual(finding.verdict, SUPPORTED);
  }
});

test('lint splits one feature into separate findings per verdict', () => {
  // A feature can be unsupported on one client and merely mitigated on
  // another; collapsing those into one finding would lose the distinction
  // that decides whether a workaround exists.
  const result = lintEmail(dataset, {
    html: '<div style="display:flex; gap:10px">hi</div>',
    clients: ['*'],
  });
  const byFeature = new Map();
  for (const finding of result.findings) {
    byFeature.set(finding.feature, (byFeature.get(finding.feature) ?? 0) + 1);
  }
  assert.ok([...byFeature.values()].some((count) => count > 1));

  // No finding ever mixes verdicts.
  for (const finding of result.findings) {
    assert.ok([UNSUPPORTED, MITIGATED, UNTESTED].includes(finding.verdict));
  }
});

test('untested findings are severity "unknown" and carry no false notes', () => {
  const result = lintEmail(dataset, {
    html: '<div style="backdrop-filter:blur(2px)">hi</div>',
    clients: ['*'],
  });
  const untested = result.findings.filter((f) => f.verdict === UNTESTED);
  assert.ok(untested.length > 0, 'expected at least one untested finding');
  for (const finding of untested) {
    assert.equal(finding.severity, 'unknown');
    assert.deepEqual(finding.notes, []);
  }
  // Guidance is a legend on the result, keyed by verdict, rather than the same
  // sentence repeated on every finding.
  assert.match(result.guidance[UNTESTED], /Not evidence of support/);
});

test('untested findings can be suppressed', () => {
  const options = { html: '<div style="backdrop-filter:blur(2px)">hi</div>', clients: ['*'] };
  const withUntested = lintEmail(dataset, options);
  const without = lintEmail(dataset, { ...options, includeUntested: false });
  assert.ok(without.findings.length < withUntested.findings.length);
  assert.ok(without.findings.every((f) => f.verdict !== UNTESTED));
});

test('findings sort errors first, then by breadth of impact', () => {
  const result = lintEmail(dataset, {
    html: '<div style="display:flex;border-radius:8px;mix-blend-mode:multiply"><video src="a.mp4"></video></div>',
    clients: ['*'],
  });
  const rank = { error: 0, warning: 1, unknown: 2 };
  for (let i = 1; i < result.findings.length; i += 1) {
    const previous = result.findings[i - 1];
    const current = result.findings[i];
    assert.ok(
      rank[previous.severity] < rank[current.severity] ||
        (previous.severity === current.severity && previous.client_count >= current.client_count),
      'findings are out of order',
    );
  }
});

test('passed is false only when an error is present', () => {
  const clean = lintEmail(dataset, { html: '<p style="color:red">hi</p>', clients: ['gmail.*'] });
  assert.equal(clean.summary.error, 0);
  assert.equal(clean.passed, true);

  const broken = lintEmail(dataset, {
    html: '<div style="display:flex">hi</div>',
    clients: ['outlook.windows'],
  });
  assert.equal(broken.passed, false);
});

test('lint accepts css on its own', () => {
  const result = lintEmail(dataset, {
    css: '.a { display: flex; border-radius: 4px; }',
    clients: ['outlook.windows'],
  });
  assert.ok(result.findings.some((f) => f.feature === 'css-display-flex'));
});

test('lint requires something to lint', () => {
  assert.throws(() => lintEmail(dataset, { clients: ['*'] }), /Provide html, css, or both/);
});

test('every finding carries the data source for auditability', () => {
  const result = lintEmail(dataset, { html: '<div style="display:flex">x</div>', clients: ['*'] });
  assert.ok(result.data_source.source);
  assert.ok(result.data_source.lastUpdate);
});

/* -------------------------------------------------------------------------- */
/* Universally-supported features                                              */
/* -------------------------------------------------------------------------- */

test('a feature every tested client supports still reports its untested clients', () => {
  // Detection used to run through the package, which reported a feature only
  // when some probed client failed to fully support it. 22 features are rated
  // `y` by every client that has data — <div>, <table>, px unit, PNG — so no
  // probe could ever surface them, and the 6-7 clients with no data at all
  // never got their `untested` verdict reported. Detection is title-based now,
  // so they do.
  const result = lintEmail(dataset, { html: '<div>hi</div>', clients: ['*'] });
  const div = result.findings.find((f) => f.title === '<div> element');
  assert.ok(div, 'expected <div> to be detected at all');
  assert.equal(div.verdict, UNTESTED);
  assert.equal(div.severity, 'unknown');
  assert.ok(div.client_count > 0);

  // And it really is untested rather than unsupported: every one of those
  // clients has no stats entry for the feature.
  const feature = dataset.byTitle.get('<div> element');
  // `clients_affected` is compressed against `clients_checked`, so expanding it
  // is how a caller gets back to identifiers — and doing so here proves the
  // compression is lossless as well as checking the verdict.
  const affected = expandClients(dataset, div.clients_affected);
  assert.equal(affected.length, div.client_count);
  for (const client of affected) {
    assert.deepEqual(versionsFor(feature, client), [], `${client} should have no data`);
  }
});

test('the rest of the former detection floor is reachable too', () => {
  const cases = [
    ['<table role="presentation"><tr><td>x</td></tr></table>', '<table> element'],
    ['<p>x</p>', '<p> element'],
    ['<h2>x</h2>', '<h1> to <h6> elements'],
    ['<td valign="top">x</td>', 'valign attribute'],
    ['<img src="a.png" alt="">', 'PNG image format'],
    ['<div style="width:10px">x</div>', 'px unit'],
    ['<div style="width:50%">x</div>', '% unit'],
    ['<div style="vertical-align:middle">x</div>', 'vertical-align'],
  ];
  for (const [html, title] of cases) {
    const result = lintEmail(dataset, { html, clients: ['*'] });
    assert.ok(
      result.findings.some((f) => f.title === title),
      `expected ${title} from ${html}`,
    );
  }
});

test('closing the floor does not disturb errors or warnings', () => {
  // The new findings are all `unknown`, and `includeUntested: false` still
  // removes every one of them. An agent that only wants real breakage sees
  // exactly what it saw before.
  const options = { html: '<div style="display:flex; gap:8px">x</div>', clients: ['*'] };
  const quiet = lintEmail(dataset, { ...options, includeUntested: false });
  assert.equal(quiet.summary.unknown, 0);
  assert.ok(quiet.summary.error > 0);
  assert.ok(quiet.findings.every((f) => f.verdict !== UNTESTED));
});

/* -------------------------------------------------------------------------- */
/* Detection                                                                   */
/* -------------------------------------------------------------------------- */

test('detection is one parse, not one per client', () => {
  // The client list cannot change what the markup contains, so the same
  // findings must come back whichever clients are asked about.
  const html = '<div style="display:flex; border-radius:8px">x</div>';
  const one = lintEmail(dataset, { html, clients: ['outlook.windows'] });
  const all = lintEmail(dataset, { html, clients: ['*'] });
  const titles = (result) => new Set(result.findings.map((f) => f.title));
  for (const title of titles(one)) assert.ok(titles(all).has(title));
});

test('lint finds declarations that appear only inside a media query', () => {
  // Responsive email lives in `@media`, and the previous parser walked only a
  // stylesheet's top level, so this was invisible.
  const result = lintEmail(dataset, {
    html: '<style>@media (max-width:600px){ .a { border-radius: 9px } }</style>',
    clients: ['outlook.windows'],
  });
  assert.ok(result.findings.some((f) => f.feature === 'css-border-radius'));
});

test('a style-block finding is positioned in document coordinates', () => {
  const html = ['<html>', '<head>', '<style>', '.a { display: flex }', '</style>'].join('\n');
  const result = lintEmail(dataset, { html, clients: ['outlook.windows'] });
  const flex = result.findings.find((f) => f.feature === 'css-display-flex');
  assert.match(flex.positions[0], /^4:/, 'the rule is on document line 4');
});

test('a malformed style attribute does not silence the rest of the email', () => {
  // This threw inside the package, and the throw was not caught, so a single
  // bad attribute returned a clean bill of health for the whole document.
  const result = lintEmail(dataset, {
    html: '<div style="display:flex">a</div><div style="not-a-declaration">b</div>',
    clients: ['outlook.windows'],
  });
  assert.ok(result.findings.some((f) => f.feature === 'css-display-flex'));
  assert.equal(result.passed, false);
});

test('markup inside a conditional comment is not reported as the document’s', () => {
  // `<!--[if mso]>…<![endif]-->` renders in one client. Reporting its contents
  // against all 48 would be wrong.
  const result = lintEmail(dataset, {
    html: '<!--[if mso]><div style="display:flex">x</div><![endif]--><p>hi</p>',
    clients: ['*'],
  });
  assert.ok(!result.findings.some((f) => f.feature === 'css-display-flex'));
  assert.ok(result.findings.some((f) => f.title === 'HTML comments'));
});

/* -------------------------------------------------------------------------- */
/* Network                                                                     */
/* -------------------------------------------------------------------------- */

test('live fetch never returns an older dataset than the bundle', { skip: !process.env.CANIEMAIL_TEST_NETWORK }, async () => {
  const live = await loadDataset({ maxAgeMs: 0 });
  assert.ok(['live', 'cache'].includes(live.meta.source));
  assert.equal(live.meta.warning, null);
  assert.ok(Date.parse(live.meta.lastUpdate) >= Date.parse(dataset.meta.lastUpdate));
});
