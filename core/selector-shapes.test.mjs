/**
 * Selector shape detection.
 *
 * Table-driven, one row per shape, plus the cases that made a tokenizer
 * necessary in the first place: a combinator inside a quoted attribute value
 * and a combinator inside a pseudo-class argument list. Both are false
 * positives for any regex, and both appear in real email CSS.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ADJACENT_SIBLING,
  ATTRIBUTE,
  CHAINING,
  CHILD,
  CLASS,
  DESCENDANT,
  GENERAL_SIBLING,
  GROUPING,
  ID,
  TYPE,
  UNIVERSAL,
  analyzeSelector,
  analyzeSelectorList,
} from './selector-shapes.mjs';

const shapesOf = (selector) => [...analyzeSelector(selector).shapes].sort();

/** One row per shape the dataset names. */
const SHAPES = [
  ['p', TYPE],
  ['*', UNIVERSAL],
  ['.klass', CLASS],
  ['#ident', ID],
  ['[data-role]', ATTRIBUTE],
  ['[href^="https"]', ATTRIBUTE],
  ['.one.two', CHAINING],
  ['.parent .descendant', DESCENDANT],
  ['.parent > .child', CHILD],
  ['.a + .adjacent', ADJACENT_SIBLING],
  ['.a ~ .sibling', GENERAL_SIBLING],
];

for (const [selector, shape] of SHAPES) {
  test(`${selector} is a ${shape}`, () => {
    assert.ok(shapesOf(selector).includes(shape), `expected ${shape} in ${shapesOf(selector)}`);
  });
}

test('grouping is a property of the list, not of any selector in it', () => {
  // Upstream asked each comma-separated selector whether it was a group, so
  // the answer was always no and this title could never be reported.
  assert.ok(!shapesOf('.grouped-one').includes(GROUPING));
  assert.ok(analyzeSelectorList(['.grouped-one', '.grouped-two']).shapes.has(GROUPING));
  assert.ok(!analyzeSelectorList(['.only-one']).shapes.has(GROUPING));
});

test('chaining is two classes on one element, not two anywhere', () => {
  assert.ok(shapesOf('.one.two').includes(CHAINING));
  assert.ok(shapesOf('a.link.active').includes(CHAINING));
  // The case upstream got wrong: these are two elements, not a chained one.
  assert.ok(!shapesOf('.parent .descendant').includes(CHAINING));
  assert.ok(!shapesOf('.card > .title').includes(CHAINING));
});

test('a combinator inside a quoted attribute value is not a combinator', () => {
  const shapes = shapesOf('[title="a > b"]');
  assert.ok(shapes.includes(ATTRIBUTE));
  assert.ok(!shapes.includes(CHILD), 'the ">" is inside a string');
  assert.ok(!shapesOf('[data-x="a + b"]').includes(ADJACENT_SIBLING));
  assert.ok(!shapesOf('[data-x="a ~ b"]').includes(GENERAL_SIBLING));
  assert.ok(!shapesOf('[data-x="a b"]').includes(DESCENDANT));
});

test('a combinator inside a pseudo-class argument is not this selector’s shape', () => {
  // `:not(a > b)` is one simple selector. Its argument is a selector in its own
  // right and its shapes belong to that one, which is how css-what modelled it.
  assert.ok(!shapesOf('.safe:not(.x + .y)').includes(ADJACENT_SIBLING));
  assert.ok(!shapesOf('p:not(a > b)').includes(CHILD));
  assert.ok(!shapesOf(':is(.a .b)').includes(DESCENDANT));
});

test('class and id spelled as attribute selectors stay class and id', () => {
  // css-what modelled `.x` and `#x` as attribute selectors named class and id,
  // and the dataset's "Attribute selector" means neither of those.
  assert.deepEqual(shapesOf('[class~="promo"]'), [CLASS]);
  assert.deepEqual(shapesOf('[id="main"]'), [ID]);
  assert.ok(shapesOf('[data-id="main"]').includes(ATTRIBUTE));
});

test('whitespace around an explicit combinator is not a descendant combinator', () => {
  assert.ok(!shapesOf('.a > .b').includes(DESCENDANT));
  assert.ok(!shapesOf('.a  +  .b').includes(DESCENDANT));
  assert.ok(!shapesOf('  .a  ').includes(DESCENDANT), 'padding is not a combinator');
  assert.ok(shapesOf('.a .b > .c').includes(DESCENDANT), 'but a real one still counts');
});

test('pseudo names are read out whole', () => {
  assert.deepEqual([...analyzeSelector('a:hover').pseudos], ['hover']);
  assert.deepEqual([...analyzeSelector('li:nth-child(2n + 1)').pseudos], ['nth-child']);
  assert.deepEqual([...analyzeSelector('p::after').pseudos], ['after']);
  assert.deepEqual([...analyzeSelector('a:has(img)').pseudos], ['has']);
  // The argument list is stepped over, not parsed as more pseudos.
  assert.deepEqual([...analyzeSelector('p:not(:hover)').pseudos], ['not']);
});

test('nesting is detected by the ampersand', () => {
  assert.equal(analyzeSelector('& .inner').nesting, true);
  assert.equal(analyzeSelector('.plain .inner').nesting, false);
  assert.equal(analyzeSelectorList(['.a', '& .b']).nesting, true);
});

test('a complex selector reports every shape it uses', () => {
  assert.deepEqual(shapesOf('main.wrap > ul#list li.item.active + li'), [
    ADJACENT_SIBLING,
    CHAINING,
    CHILD,
    CLASS,
    DESCENDANT,
    ID,
    TYPE,
  ]);
});

test('malformed selectors degrade rather than throw', () => {
  for (const selector of ['', '   ', '>', '[unclosed', ':not(', '.a..b', '::', '#']) {
    assert.doesNotThrow(() => analyzeSelector(selector), `threw on ${JSON.stringify(selector)}`);
  }
});
