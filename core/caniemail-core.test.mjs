/**
 * Tests for the shared core.
 *
 * These run offline against the dataset bundled in the npm package, so they are
 * deterministic and safe for CI. Network-dependent behaviour is gated behind
 * CANIEMAIL_TEST_NETWORK=1.
 *
 * Much of this file is regression coverage for defects in the upstream
 * `caniemail` package that this core exists to correct. Those tests are written
 * against *our* behaviour, not the package's, so they keep passing if upstream
 * is fixed — but they fail loudly if a refactor ever starts delegating
 * resolution back to the package.
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
  assert.equal(typeof flex.position.start.line, 'number');

  const radius = result.findings.find((f) => f.feature === 'css-border-radius');
  assert.ok(radius.notes.some((n) => /VML|RoundRect/i.test(n)), 'expected the VML workaround note');
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
    assert.match(finding.guidance, /Not evidence of support/);
  }
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
/* Network                                                                     */
/* -------------------------------------------------------------------------- */

test('live fetch returns a newer dataset than the bundle', { skip: !process.env.CANIEMAIL_TEST_NETWORK }, async () => {
  const live = await loadDataset({ maxAgeMs: 0 });
  assert.ok(['live', 'cache'].includes(live.meta.source));
  assert.equal(live.meta.warning, null);
  assert.ok(Date.parse(live.meta.lastUpdate) >= Date.parse(dataset.meta.lastUpdate));
});
