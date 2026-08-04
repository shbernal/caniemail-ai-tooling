/**
 * Differential suite: our extractor against the `caniemail` package it replaced.
 *
 * The package is a devDependency for exactly this reason. It is no longer in
 * the shipped dependency tree, but it is still the only independent
 * implementation of the ~660 lines we took over, so it stays around as the
 * thing we are checked against.
 *
 * Two assertions, per fixture:
 *
 * 1. Every title upstream finds, we find — bar a short allowlist of titles
 *    upstream reports *wrongly*, each named below with its cause.
 * 2. Every position upstream reports, we report identically — unless the
 *    difference is one of the defects this port exists to correct, and the
 *    difference is checked to actually *be* that defect rather than merely
 *    excused as one. `adjustPosition` is reimplemented here so the `<style>`
 *    offset claim is verified arithmetically, not asserted.
 *
 * Findings we add and upstream missed are not constrained: being a strict
 * superset is the point. They are pinned instead by the golden files in
 * `fixtures/expected/`, so an accidental change to detection shows up as a
 * reviewable diff. Regenerate them with `make goldens`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectFeatures, formatPosition } from './detect.mjs';
import { scanHtml } from './html-scan.mjs';
import { upstreamDetect } from './upstream-detect.mjs';
import snapshot from './data/caniemail.json' with { type: 'json' };

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, 'fixtures', 'emails');
const goldenDir = join(here, 'fixtures', 'expected');
const dataset = { features: snapshot.data };
const fixtures = readdirSync(fixtureDir).sort();
const updateGoldens = process.env.UPDATE_GOLDENS === '1';

/**
 * Titles upstream reports that we deliberately do not.
 *
 * This list is short on purpose: every entry is a case where upstream's
 * detection is wrong, not merely different. Anything else appearing here would
 * mean the port lost coverage.
 */
const EXPECTED_MISSING = {
  // `getMatchingElementTitles` compares with `tagName.includes(value)`, so
  // `<article>` matches the title `<rt> element` on the substring "rt". We
  // match tag names exactly, and still report `<rt>` where a real one appears.
  '<rt> element': {
    fixtures: ['html-elements.html'],
    reason: 'upstream substring-matches tag names; <article> is not an <rt>',
  },
  // Upstream counts class tokens across a whole complex selector, so
  // `.card > .title` reads as chained. Chaining is two simple selectors on one
  // element (`.one.two`), which is per-compound.
  'Chaining selectors': {
    fixtures: ['template-responsive.html'],
    reason: 'upstream counts classes across combinators; chaining is per-compound',
  },
};

/**
 * Titles whose position we move for a reason no rule can derive.
 *
 * Everything else must be explained by one of the mechanical classifiers below.
 */
const EXPECTED_MOVES = {
  '<rt> element': {
    fixtures: ['html-elements.html'],
    reason: 'upstream reported a substring false positive on <article>; ours is the real <rt>',
  },
};

/* -------------------------------------------------------------------------- */
/* Divergence classifiers                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The package's `adjustPosition`, reproduced so the `<style>` offset defect can
 * be verified rather than waved through: applying the offset it never applied
 * to a `<style>` block must turn its position into ours.
 */
function adjustPosition(position, offset) {
  return {
    start: {
      line: position.start.line + offset.line - 1,
      column:
        position.start.line === 1 ? position.start.column + offset.column - 1 : position.start.column,
    },
    end: {
      line: position.end.line + offset.line - 1,
      column:
        position.end.line === 1 ? position.end.column + offset.column - 1 : position.end.column,
    },
  };
}

/** Document coordinates of the first character of each `<style>` block's text. */
function styleBlockOffsets(html) {
  const starts = [0];
  for (let i = 0; i < html.length; i += 1) if (html[i] === '\n') starts.push(i + 1);
  const locate = (offset) => {
    let low = 0;
    for (let i = 0; i < starts.length; i += 1) if (starts[i] <= offset) low = i;
    return { line: low + 1, column: offset - starts[low] + 1 };
  };
  return scanHtml(html).styleBlocks.map((block) => locate(block.textStart));
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const before = (a, b) => a.line < b.line || (a.line === b.line && a.column <= b.column);

/** Is `inner` wholly inside `outer`? */
const contains = (outer, inner) =>
  before(outer.start, inner.start) && before(inner.end, outer.end);

/**
 * Why does our position differ from upstream's? Null means "no known reason",
 * which fails the test.
 */
function classifyMove(title, upstreamPosition, ourPosition, offsets) {
  if (!upstreamPosition) {
    // Upstream emitted no position at all: every at-rule (it never passed one),
    // and any element whose end offset it could not resolve.
    return 'upstream reported no position';
  }
  for (const offset of offsets) {
    if (same(adjustPosition(upstreamPosition, offset), ourPosition)) {
      return '<style> block position was never offset to document coordinates';
    }
  }
  if (contains(upstreamPosition, ourPosition)) {
    // A `style=""` declaration reported at the element's span, because the
    // offset upstream computed for it was always undefined; or a declaration
    // inside an at-rule block, which upstream never descended into.
    return 'position narrowed from the enclosing element or block to the declaration';
  }
  return EXPECTED_MOVES[title]?.reason ?? null;
}

/* -------------------------------------------------------------------------- */
/* The suite                                                                   */
/* -------------------------------------------------------------------------- */

function inputFor(name, code) {
  return name.endsWith('.css') ? { css: code } : { html: code };
}

/** Upstream's position object in our rendering, or a marker when it reported none. */
function describePosition(position) {
  return position ? formatPosition(position) : 'no-position';
}

/**
 * Our `L:C-L:C` rendering, back into the object shape upstream reports.
 *
 * `classifyMove` compares positions arithmetically — offsetting them, testing
 * containment — which needs numbers rather than a string. Parsing here rather
 * than exporting a parser from the core keeps a function that exists only for
 * this suite out of the vendored modules, as `adjustPosition` already is.
 */
function parsePosition(text) {
  const [start, end] = text.split('-').map((point) => {
    const [line, column] = point.split(':').map(Number);
    return { line, column };
  });
  return { start, end };
}

test('the corpus covers every mapping category', () => {
  // A guard on the fixtures themselves: if one is deleted the suite must not
  // quietly get easier.
  assert.ok(fixtures.length >= 15, `expected a broad corpus, found ${fixtures.length} fixtures`);
  for (const required of [
    'css-at-rules.css',
    'css-hostile.css',
    'css-images.css',
    'css-properties.css',
    'css-selectors.css',
    'css-values.css',
    'html-attributes.html',
    'html-comments.html',
    'html-elements.html',
    'html-hostile.html',
    'html-images.html',
    'html-style-attr.html',
    'html-style-block.html',
  ]) {
    assert.ok(fixtures.includes(required), `missing fixture ${required}`);
  }
});

for (const name of fixtures) {
  const code = readFileSync(join(fixtureDir, name), 'utf8');
  const input = inputFor(name, code);

  test(`${name}: we find everything upstream finds`, () => {
    const upstream = upstreamDetect(input);
    const ours = detectFeatures(dataset, input);

    for (const title of upstream.keys()) {
      if (ours.has(title)) continue;
      const allowed = EXPECTED_MISSING[title];
      assert.ok(
        allowed?.fixtures.includes(name),
        `lost "${title}" in ${name} with no recorded reason`,
      );
    }
  });

  test(`${name}: positions agree, or diverge for a verified reason`, () => {
    const upstream = upstreamDetect(input);
    const ours = detectFeatures(dataset, input);
    const offsets = name.endsWith('.css') ? [] : styleBlockOffsets(code);

    for (const [title, hit] of upstream) {
      const mine = ours.get(title);
      if (!mine) continue; // Covered by the previous test.
      // Upstream reports one position per title; ours reports every occurrence.
      // The first is still the earliest, so it is the one to compare.
      const [ourFirst] = mine.positions;
      if (describePosition(hit.position) === ourFirst) continue;

      const reason = classifyMove(title, hit.position, parsePosition(ourFirst), offsets);
      assert.ok(
        reason,
        `"${title}" in ${name} moved ${describePosition(hit.position)} -> ` +
          `${ourFirst} for no known reason`,
      );
    }
  });

  test(`${name}: output matches its golden file`, () => {
    const ours = detectFeatures(dataset, input);
    // `(xN)` is suppressed at N=1, so a single-occurrence line renders exactly
    // as it always has. A goldens diff then shows only the titles that gained
    // occurrences, which is the reviewable signal rather than a full rewrite.
    const lines = [...ours.values()]
      .map((hit) => {
        const repeats = hit.occurrence_count > 1 ? ` (x${hit.occurrence_count})` : '';
        return `${hit.positions[0]}${repeats}\t${hit.title}`;
      })
      .sort();
    const rendered = `${lines.join('\n')}\n`;
    const goldenPath = join(goldenDir, `${name}.txt`);

    if (updateGoldens) {
      writeFileSync(goldenPath, rendered);
      return;
    }
    assert.ok(existsSync(goldenPath), `no golden for ${name}; run: make goldens`);
    assert.equal(rendered, readFileSync(goldenPath, 'utf8'), `${name} drifted from its golden`);
  });
}

test('detection is a strict improvement across the whole corpus', () => {
  let found = 0;
  let added = 0;
  for (const name of fixtures) {
    const input = inputFor(name, readFileSync(join(fixtureDir, name), 'utf8'));
    const upstream = upstreamDetect(input);
    const ours = detectFeatures(dataset, input);
    found += upstream.size;
    added += [...ours.keys()].filter((title) => !upstream.has(title)).length;
  }
  // Not a vanity metric: the port would be worth much less if it merely
  // reproduced upstream, and this is what says it does not. Across the corpus
  // upstream finds 267 titles and we add 125 it cannot reach at all — the
  // detection floor, at-rule blocks, every CSS function, and the fixtures whose
  // markup made it throw.
  assert.ok(added > found * 0.4, `expected a large net gain, got +${added} on ${found}`);
});

test('a malformed style attribute does not void the whole result', () => {
  // Upstream throws out of `style-to-object` here, and `caniemail()` has no
  // try/catch, so every one of the 48 clients dies and the lint returns
  // nothing at all. One bad attribute, and the entire email reads as clean.
  const html = '<div style="display:flex">a</div><div style="not-a-declaration">b</div>';
  assert.equal(upstreamDetect({ html }).size, 0);
  assert.ok(detectFeatures(dataset, { html }).has('display:flex'));
});
