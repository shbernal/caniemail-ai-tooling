/**
 * Feature title tables.
 *
 * The tables are derived from dataset titles by convention rather than frozen
 * as a list, so a feature added upstream is picked up without a release here.
 * The cost of that choice is that a novel title *shape* is silently unreachable,
 * which is what the coverage test at the bottom of this file exists to catch.
 *
 * Run against the committed snapshot, so these are deterministic.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import snapshot from './data/caniemail.json' with { type: 'json' };
import {
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

const tables = buildTitleTables(snapshot.data);

test('the tables are memoised per dataset', () => {
  assert.equal(buildTitleTables(snapshot.data), tables);
});

/* -------------------------------------------------------------------------- */
/* CSS                                                                         */
/* -------------------------------------------------------------------------- */

test('a property matches its own title and the shorthands it extends', () => {
  assert.deepEqual(matchProperty(tables, 'display'), ['display']);
  const radius = matchProperty(tables, 'border-radius');
  assert.ok(radius.includes('border-radius'));
  assert.ok(radius.includes('border'), 'the shorthand title covers its longhands');
  assert.ok(matchProperty(tables, 'font-weight').includes('font shorthand'));
  // A prefix that is not a hyphen boundary is not a match.
  assert.ok(!matchProperty(tables, 'floating').includes('float'));
});

test('titles naming several properties are recovered', () => {
  assert.ok(matchProperty(tables, 'column-count').includes('css column properties'));
  assert.ok(matchProperty(tables, 'gap').includes('gap, column-gap, row-gap'));
  assert.ok(matchProperty(tables, 'grid-template-columns').includes('grid-template-* properties'));
  assert.ok(matchProperty(tables, 'left').includes('left, right, top, bottom'));
  assert.ok(matchProperty(tables, 'color-scheme').includes('color-scheme CSS property'));
});

test('a title with stray whitespace still yields its property', () => {
  // The dataset carries a title of exactly "inline-size " — with the space.
  assert.ok(matchProperty(tables, 'inline-size').includes('inline-size '));
});

test('property/value pairs match exactly, and ignore !important', () => {
  assert.deepEqual(matchPropertyValuePair(tables, 'display', 'flex'), ['display:flex']);
  assert.deepEqual(matchPropertyValuePair(tables, 'display', 'grid'), ['display:grid']);
  assert.deepEqual(matchPropertyValuePair(tables, 'display', 'inline-block'), []);
  // Upstream compared the raw value, so `display: none !important` — which is
  // how half the responsive email on earth hides a column — never matched.
  assert.deepEqual(matchPropertyValuePair(tables, 'display', 'none !important'), ['display:none']);
});

test('CSS functions are detected', () => {
  // Upstream iterated its function table with key and value transposed, so
  // every one of these titles was unreachable regardless of input.
  assert.deepEqual(matchFunctions(tables, 'calc(100% - 20px)'), ['CSS calc() function']);
  assert.deepEqual(matchFunctions(tables, 'clamp(12px, 2vw, 18px)'), ['clamp()']);
  assert.deepEqual(matchFunctions(tables, 'var(--brand)'), ['CSS Variables (Custom Properties)']);
  assert.ok(matchFunctions(tables, 'linear-gradient(#fff, #000)').includes('linear-gradient()'));
  assert.ok(matchFunctions(tables, 'rgb(255 0 0)').includes('rgb()'));
  assert.deepEqual(matchFunctions(tables, 'red'), []);
});

test('a title naming several functions matches any of them', () => {
  const title = 'lch(), oklch(), lab(), oklab()';
  for (const call of ['lch(50% 0 0)', 'oklch(50% 0 0)', 'lab(50 0 0)', 'oklab(50% 0 0)']) {
    assert.ok(matchFunctions(tables, call).includes(title), `${call} should match ${title}`);
  }
});

test('units only count immediately after a number', () => {
  assert.deepEqual(matchUnits(tables, '10px'), ['px unit']);
  assert.deepEqual(matchUnits(tables, '1.5em'), ['em unit']);
  assert.deepEqual(matchUnits(tables, '50%'), ['% unit']);
  assert.deepEqual(matchUnits(tables, '1rem'), ['rem unit'], 'rem is not em');
  assert.deepEqual(matchUnits(tables, '0'), [], 'a bare number has no unit');
  assert.deepEqual(matchUnits(tables, 'margin-inline'), [], '"in" inside a word is not a unit');
  assert.deepEqual(matchUnits(tables, 'initial'), ['initial unit']);
});

test('keywords and bare values are matched as words', () => {
  assert.deepEqual(matchKeywords(tables, 'none !important'), ['!important keyword']);
  assert.deepEqual(matchKeywords(tables, 'none'), []);
  assert.ok(matchValues(tables, 'fit-content').includes('fit-content, min-content, max-content'));
  assert.ok(
    matchValues(tables, 'system-ui, sans-serif').includes(
      'system-ui, ui-serif, ui-sans-serif, ui-rounded, ui-monospace',
    ),
  );
  assert.deepEqual(matchValues(tables, 'notfit-contentx'), [], 'whole words only');
});

test('at-rules match by name, and media features by prelude', () => {
  assert.deepEqual(matchAtRule(tables, 'font-face'), ['@font-face']);
  assert.deepEqual(matchAtRule(tables, 'supports', '(display: grid)'), ['@supports']);
  // Upstream compared these titles against bare node type names, so the five
  // media-feature titles could never match anything.
  assert.deepEqual(matchAtRule(tables, 'media', '(prefers-color-scheme: dark)').sort(), [
    '@media',
    '@media (prefers-color-scheme)',
  ]);
  assert.deepEqual(matchAtRule(tables, 'media', 'screen and (max-width: 600px)'), ['@media']);
  assert.ok(matchAtRule(tables, 'media', '(any-hover: hover)').includes(
    '@media (hover), @media (any-hover)',
  ));
});

test('pseudo-classes and pseudo-elements match by name', () => {
  assert.deepEqual(matchPseudo(tables, 'hover'), [':hover']);
  assert.deepEqual(matchPseudo(tables, 'after'), ['::after']);
  assert.deepEqual(matchPseudo(tables, 'nth-child'), [':nth-child']);
  // The title is written `:has()`; the selector is written `:has(img)`.
  assert.deepEqual(matchPseudo(tables, 'has'), [':has()']);
  assert.deepEqual(matchPseudo(tables, 'nonsense'), []);
});

/* -------------------------------------------------------------------------- */
/* HTML                                                                        */
/* -------------------------------------------------------------------------- */

test('elements match by exact tag name', () => {
  assert.deepEqual(matchElement(tables, 'video'), ['<video> element']);
  assert.deepEqual(matchElement(tables, 'rt'), ['<rt> element']);
  // Upstream substring-matched, so `<article>` reported the `<rt>` feature.
  assert.deepEqual(matchElement(tables, 'article'), ['HTML5 semantics']);
});

test('titles naming several elements match each of them', () => {
  for (const tag of ['ul', 'ol', 'dl']) {
    assert.deepEqual(matchElement(tables, tag), ['<ul>, <ol> and <dl>'], `<${tag}>`);
  }
  for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
    assert.deepEqual(matchElement(tables, tag), ['<h1> to <h6> elements'], `<${tag}>`);
  }
  for (const tag of ['section', 'article', 'figure', 'summary', 'time']) {
    assert.deepEqual(matchElement(tables, tag), ['HTML5 semantics'], `<${tag}>`);
  }
});

test('elements the title does not spell out are still mapped', () => {
  assert.deepEqual(matchElement(tables, 'address'), ['address']);
  assert.deepEqual(matchElement(tables, 'map'), ['Image maps']);
  assert.deepEqual(matchElement(tables, 'image'), ['Embedded <svg> image']);
});

test('attributes match by name', () => {
  assert.deepEqual(matchAttributes(tables, ['role']), ['role attribute']);
  assert.deepEqual(matchAttributes(tables, ['valign']), ['valign attribute']);
  assert.deepEqual(matchAttributes(tables, ['srcset']), ['srcset and sizes attributes']);
  assert.deepEqual(matchAttributes(tables, ['sizes']), ['srcset and sizes attributes']);
  assert.deepEqual(matchAttributes(tables, ['nonsense']), []);
});

test('element/attribute pairs need both halves', () => {
  const pair = (tag, attributes) => matchElementAttributes(tables, tag, new Map(attributes));
  assert.deepEqual(pair('input', [['type', 'checkbox']]), ['<input type="checkbox"> element']);
  assert.deepEqual(pair('input', [['type', 'text']]), ['<input type="text"> element']);
  assert.deepEqual(pair('button', [['type', 'submit']]), ['<button type="submit"> element']);
  assert.deepEqual(pair('div', [['type', 'checkbox']]), [], 'the element has to match too');
  assert.deepEqual(pair('meta', [['name', 'color-scheme']]), ['color-scheme meta tag']);
  assert.deepEqual(pair('meta', [['name', 'viewport']]), []);
});

test('anchor pairs distinguish local, mail and ordinary links', () => {
  const pair = (attributes) => matchElementAttributes(tables, 'a', new Map(attributes));
  assert.deepEqual(pair([['href', '#top']]), ['Local anchors']);
  assert.deepEqual(pair([['name', 'top']]), ['Local anchors']);
  assert.deepEqual(pair([['href', 'mailto:a@b.c']]), ['mailto: links']);
  assert.deepEqual(pair([['href', 'https://example.com']]), []);
});

test('AMP is declared by either spelling of its attribute', () => {
  const pair = (attributes) => matchElementAttributes(tables, 'html', new Map(attributes));
  assert.deepEqual(pair([['⚡4email', '']]), ['AMP for Email']);
  assert.deepEqual(pair([['amp4email', '']]), ['AMP for Email']);
  assert.deepEqual(pair([['lang', 'en']]), []);
});

test('attribute value comparisons are case-insensitive, as HTML is', () => {
  assert.deepEqual(
    matchElementAttributes(tables, 'input', new Map([['type', 'CHECKBOX']])),
    ['<input type="checkbox"> element'],
  );
});

/* -------------------------------------------------------------------------- */
/* Images                                                                      */
/* -------------------------------------------------------------------------- */

test('image formats are read from the extension', () => {
  assert.equal(matchImageUrl(tables, 'hero.png'), 'PNG image format');
  assert.equal(matchImageUrl(tables, 'photo.JPG'), 'JPG image format');
  assert.equal(matchImageUrl(tables, 'shot.avif'), 'AVIF image format');
  assert.equal(matchImageUrl(tables, 'photo.heic'), 'HEIF image format');
  assert.equal(matchImageUrl(tables, 'banner.jpeg?v=2#frag'), 'JPG image format');
  assert.equal(matchImageUrl(tables, 'https://example.com/render'), undefined);
});

test('image formats are read from a data URI mime type', () => {
  assert.equal(matchImageUrl(tables, 'data:image/gif;base64,R0lGOD'), 'GIF image format');
  assert.equal(matchImageUrl(tables, 'data:image/svg+xml;utf8,<svg/>'), 'SVG image format');
  assert.equal(matchImageUrl(tables, 'data:text/plain,hello'), undefined);
});

test('urls are pulled out of srcset and url()', () => {
  assert.deepEqual(urlsFromSrcset('small.png 1x, large.webp 2x'), ['small.png', 'large.webp']);
  assert.deepEqual(urlsFromCssValue('url(a.png)'), ['a.png']);
  assert.deepEqual(urlsFromCssValue('url("a.png"), url(\'b.gif\')'), ['a.png', 'b.gif']);
  assert.deepEqual(urlsFromCssValue('url( spaced.webp )'), ['spaced.webp']);
  assert.deepEqual(urlsFromCssValue('none'), []);
});

/* -------------------------------------------------------------------------- */
/* Coverage                                                                    */
/* -------------------------------------------------------------------------- */

test('the tables reach all but the four features markup cannot express', () => {
  // Deriving titles by convention means a novel title shape goes unnoticed
  // rather than failing loudly. This is the tripwire: if upstream invents a
  // shape the conventions miss, the reachable count drops and this fails.
  const reachable = new Set();
  const add = (titles) => {
    for (const entry of titles) reachable.add(entry.title);
  };
  add(tables.atRules);
  add(tables.functions);
  add(tables.keywords);
  add(tables.propertyValuePairs);
  add(tables.properties);
  add(tables.units);
  add(tables.values);
  add(tables.pseudos);
  add(tables.elements);
  add(tables.attributes);
  add(tables.elementAttributes);
  for (const title of tables.selectorShapes) reachable.add(title);
  for (const title of Object.values(tables.imageExtensions)) reachable.add(title);
  for (const title of Object.values(tables.imageMimes)) reachable.add(title);
  for (const title of ['CSS comments', 'CSS Nesting', 'HTML comments', 'HTML5 doctype']) {
    reachable.add(title);
  }

  const unreachable = snapshot.data
    .map((feature) => feature.title)
    .filter((title) => !reachable.has(title))
    .sort();

  // The four that are genuinely not detectable from HTML or CSS: three image
  // properties no URL declares, and a DNS record.
  assert.deepEqual(unreachable, [
    'BIMI',
    'Base 64 image format',
    'HDR image format',
    'Video as Image Assets',
  ]);
  assert.equal(reachable.size >= snapshot.data.length - 4, true);
});
