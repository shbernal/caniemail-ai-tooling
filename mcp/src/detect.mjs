/**
 * caniemail-ai-tooling — feature detection.
 *
 * Turns HTML and CSS into the set of caniemail feature titles the markup uses,
 * with a position for each. One parse, no email clients involved.
 *
 * That last part is the whole point. Detection asks "what does this markup
 * use?", which has nothing to do with which client is being checked, and
 * `resolveSupport` answers "how well does client X support it?". The previous
 * implementation could not separate the two: the package only reported a
 * feature when some probed client failed to fully support it, so detection had
 * to run 48 times and union the results, and a feature every client supports
 * was undetectable no matter how many clients were probed.
 *
 * Because titles are matched directly, that floor is gone. `<div>`, `<table>`,
 * `px unit` and the other 19 universally-supported features are now detected
 * like any other, and the `untested` verdicts they carry on clients with no
 * data reach the output — which is what the four-verdict invariant always
 * promised and could not previously deliver.
 *
 * Vendored byte-identically into `skill/scripts/` and `mcp/src/`; never edit a
 * vendored copy, edit this file and run `make sync-core`.
 */

import { scanCss, scanStyleAttribute } from './css-scan.mjs';
import { scanHtml } from './html-scan.mjs';
import { analyzeSelectorList } from './selector-shapes.mjs';
import {
  CSS_COMMENTS_TITLE,
  CSS_NESTING_TITLE,
  HTML_COMMENTS_TITLE,
  HTML_DOCTYPE_TITLE,
  buildTitleTables,
  matchAtRule,
  matchAttributes,
  matchElement,
  matchElementAttributes,
  matchFunctions,
  matchImageUrl,
  matchKeywords,
  matchProperty,
  matchPropertyValuePair,
  matchPseudo,
  matchUnits,
  matchValues,
  urlsFromCssValue,
  urlsFromSrcset,
} from './feature-titles.mjs';

/**
 * Maps a 0-based offset to a 1-based line and column.
 *
 * Replaces the `binary-search` + `split-lines` pair the package used. An
 * offset past the end clamps to the last position rather than returning
 * nothing: a finding with no position is less useful than one at the end of
 * the document, and unclosed markup made that the common case.
 */
class LineIndex {
  #starts = [0];

  constructor(source) {
    for (let i = 0; i < source.length; i += 1) {
      if (source[i] === '\n') this.#starts.push(i + 1);
    }
    this.length = source.length;
  }

  /** @returns {{line: number, column: number}} */
  locate(offset) {
    const clamped = Math.max(0, Math.min(offset, this.length));
    let low = 0;
    let high = this.#starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (this.#starts[mid] <= clamped) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: clamped - this.#starts[low] + 1 };
  }
}

/**
 * A title and the earliest place it was seen, in one coordinate space.
 *
 * Sightings are collected as offsets and resolved to line/column at the end, so
 * "earliest" is a numeric comparison rather than a line-then-column one, and so
 * CSS found inside a `<style>` block is measured in document coordinates by
 * plain addition instead of the package's `adjustPosition` arithmetic — which
 * it never applied to `<style>` blocks, putting every such finding on the wrong
 * line.
 */
class Sightings {
  #hits = new Map();

  constructor(source, tables) {
    this.index = new LineIndex(source);
    this.tables = tables;
  }

  /** @param {string} title @param {number} start @param {number} end */
  record(title, start, end) {
    if (!this.tables.known.has(title)) return; // A title the dataset dropped.
    const existing = this.#hits.get(title);
    if (existing && existing.start <= start) return;
    this.#hits.set(title, { start, end });
  }

  /** @returns {Map<string, {title: string, position: object}>} */
  resolve() {
    const out = new Map();
    for (const [title, { start, end }] of this.#hits) {
      out.set(title, {
        title,
        position: { start: this.index.locate(start), end: this.index.locate(end) },
      });
    }
    return out;
  }
}

/**
 * Detect the caniemail features used by some markup.
 *
 * @param {{features: object[]}} dataset
 * @param {{html?: string, css?: string}} input
 * @returns {Map<string, {title: string, position: object}>}
 */
export function detectFeatures(dataset, { html, css } = {}) {
  const tables = buildTitleTables(dataset.features ?? []);
  const detected = new Map();

  // Both inputs are their own coordinate space, so they are collected
  // separately. Standalone CSS wins a tie, matching the order the previous
  // implementation happened to use — stylesheets before document.
  if (css) {
    const sightings = new Sightings(css, tables);
    detectStylesheet(css, 0, sightings);
    for (const [title, hit] of sightings.resolve()) detected.set(title, hit);
  }

  if (html) {
    const sightings = new Sightings(html, tables);
    detectHtml(html, sightings);
    for (const [title, hit] of sightings.resolve()) {
      if (!detected.has(title)) detected.set(title, hit);
    }
  }

  return detected;
}

/* -------------------------------------------------------------------------- */
/* HTML                                                                        */
/* -------------------------------------------------------------------------- */

function detectHtml(source, sightings) {
  const { tables } = sightings;
  const scan = scanHtml(source);

  for (const doctype of scan.doctypes) {
    // The package mapped `HTML5 doctype` to an element named `!doctype html`
    // and then only ever visited real tags, so the mapping was dead.
    if (/^<!doctype\s+html\s*>/i.test(source.slice(doctype.start, doctype.end + 1))) {
      sightings.record(HTML_DOCTYPE_TITLE, doctype.start, doctype.end);
    }
  }

  for (const comment of scan.comments) {
    sightings.record(HTML_COMMENTS_TITLE, comment.start, comment.end);
  }

  for (const element of scan.elements) {
    const { start, end } = element;
    const names = element.attributes.map((attribute) => attribute.name);
    const values = new Map(element.attributes.map((attribute) => [attribute.name, attribute.value]));

    for (const title of matchElement(tables, element.tagName)) sightings.record(title, start, end);
    for (const title of matchAttributes(tables, names)) sightings.record(title, start, end);
    for (const title of matchElementAttributes(tables, element.tagName, values)) {
      sightings.record(title, start, end);
    }

    const urls = [];
    if (element.tagName === 'img' && values.get('src')) urls.push(values.get('src'));
    if (values.get('srcset')) urls.push(...urlsFromSrcset(values.get('srcset')));
    for (const url of urls) {
      const title = matchImageUrl(tables, url);
      if (title) sightings.record(title, start, end);
    }

    const style = element.attributes.find((attribute) => attribute.name === 'style');
    if (style && style.value.trim()) {
      // Positions point at the declaration inside the attribute, not at the
      // element. The package had the offsets to do this and passed `undefined`,
      // so every inline finding pointed at the whole tag.
      for (const declaration of scanStyleAttribute(style.value)) {
        detectDeclaration(declaration, style.valueStart, sightings);
      }
    }
  }

  for (const block of scan.styleBlocks) {
    detectStylesheet(source.slice(block.textStart, block.textEnd), block.textStart, sightings);
  }
}

/* -------------------------------------------------------------------------- */
/* CSS                                                                         */
/* -------------------------------------------------------------------------- */

function detectStylesheet(text, base, sightings) {
  const { tables } = sightings;
  const scan = scanCss(text);

  for (const comment of scan.comments) {
    sightings.record(CSS_COMMENTS_TITLE, base + comment.start, base + comment.end);
  }

  for (const atRule of scan.atRules) {
    for (const title of matchAtRule(tables, atRule.name, atRule.prelude)) {
      sightings.record(title, base + atRule.start, base + atRule.end);
    }
  }

  for (const rule of scan.rules) {
    const start = base + rule.start;
    const end = base + rule.end;
    const analysis = analyzeSelectorList(rule.selectors);

    for (const shape of analysis.shapes) {
      if (tables.selectorShapes.has(shape)) sightings.record(shape, start, end);
    }
    for (const pseudo of analysis.pseudos) {
      for (const title of matchPseudo(tables, pseudo)) sightings.record(title, start, end);
    }
    if (analysis.nesting) sightings.record(CSS_NESTING_TITLE, start, end);

    for (const declaration of rule.declarations) detectDeclaration(declaration, base, sightings);
  }

  // Declarations that belong to no style rule: `@font-face`, `@page`, and the
  // stops inside `@keyframes`.
  for (const declaration of scan.declarations) detectDeclaration(declaration, base, sightings);
}

function detectDeclaration(declaration, base, sightings) {
  const { tables } = sightings;
  const { property, value } = declaration;
  const start = base + declaration.start;
  const end = base + declaration.end;

  for (const title of matchProperty(tables, property)) sightings.record(title, start, end);
  if (value) {
    for (const title of matchPropertyValuePair(tables, property, value)) {
      sightings.record(title, start, end);
    }
    for (const title of matchFunctions(tables, value)) sightings.record(title, start, end);
    for (const title of matchKeywords(tables, value)) sightings.record(title, start, end);
    for (const title of matchValues(tables, value)) sightings.record(title, start, end);
    for (const title of matchUnits(tables, value)) sightings.record(title, start, end);
    for (const url of urlsFromCssValue(value)) {
      const title = matchImageUrl(tables, url);
      if (title) sightings.record(title, start, end);
    }
  }
}
