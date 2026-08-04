/**
 * CSS scanner.
 *
 * Two things are load-bearing here. Positions, because a finding an agent
 * cannot locate is close to useless; and tolerance, because email CSS arrives
 * truncated, doubly-escaped and hand-edited, and a parser that stops at the
 * first bad declaration reports nothing about the rest.
 *
 * The at-rule tests are the ones worth reading. The previous implementation
 * walked only a stylesheet's top level, so a declaration that appeared solely
 * inside `@media` — which is where responsive email CSS lives — was invisible.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { scanCss, scanStyleAttribute, splitTopLevel } from './css-scan.mjs';

const declarationsIn = (css) =>
  scanCss(css).rules.flatMap((rule) =>
    rule.declarations.map((declaration) => `${declaration.property}:${declaration.value}`),
  );

test('a rule yields its selectors and declarations', () => {
  const scan = scanCss('.a, .b > c { display: flex; border-radius: 4px }');
  assert.equal(scan.rules.length, 1);
  assert.deepEqual(scan.rules[0].selectors, ['.a', '.b > c']);
  assert.deepEqual(
    scan.rules[0].declarations.map((declaration) => [declaration.property, declaration.value]),
    [
      ['display', 'flex'],
      ['border-radius', '4px'],
    ],
  );
});

test('a declaration spans from its property to its terminator', () => {
  const css = '  .a { display: flex; border-radius: 4px }';
  const [first, second] = scanCss(css).rules[0].declarations;
  assert.equal(css.slice(first.start, first.end), 'display: flex');
  assert.equal(css[first.end], ';');
  // The last declaration in a block is terminated by the closing brace.
  assert.equal(css.slice(second.start, second.end), 'border-radius: 4px ');
  assert.equal(css[second.end], '}');
});

test('a rule spans from its selector to one past its closing brace', () => {
  const css = '  .a { color: red }';
  const [rule] = scanCss(css).rules;
  assert.equal(css.slice(rule.start, rule.end), '.a { color: red }');
});

test('declarations inside at-rule blocks are found', () => {
  // The hole this port exists to close: upstream iterated top-level rules only.
  const css = '@media screen and (max-width: 600px) { .card { border-radius: 12px } }';
  assert.deepEqual(declarationsIn(css), ['border-radius:12px']);
  assert.deepEqual(scanCss(css).rules[0].selectors, ['.card']);
});

test('nested at-rules are descended into as well', () => {
  const css = '@media (prefers-color-scheme: dark) { @supports (gap: 1px) { .a { gap: 8px } } }';
  assert.deepEqual(declarationsIn(css), ['gap:8px']);
  assert.deepEqual(scanCss(css).atRules.map((rule) => rule.name), ['supports', 'media']);
});

test('at-rules carry a position and a prelude', () => {
  const css = '@media (prefers-color-scheme: dark) { .a { color: red } }';
  const [atRule] = scanCss(css).atRules;
  assert.equal(atRule.name, 'media');
  assert.equal(atRule.prelude, '(prefers-color-scheme: dark)');
  assert.equal(css.slice(atRule.start, atRule.end), css);
});

test('a vendor-prefixed at-rule keeps the unprefixed name', () => {
  assert.deepEqual(scanCss('@-webkit-keyframes f { from { opacity: 0 } }').atRules.map((r) => r.name), [
    'keyframes',
  ]);
});

test('a statement at-rule ends at its semicolon', () => {
  const css = '@import url("other.css");\n.a { color: red }';
  const [atRule] = scanCss(css).atRules;
  assert.equal(css.slice(atRule.start, atRule.end), '@import url("other.css");');
});

test('keyframe stops contribute declarations but not selectors', () => {
  // `from` is a keyframe stop, not a type selector. Reporting it as one would
  // be a pure false positive, and descending into at-rules is what exposes it.
  const scan = scanCss('@keyframes fade { from { opacity: 0 } to { opacity: 1 } }');
  assert.equal(scan.rules.length, 0);
  assert.deepEqual(scan.declarations.map((declaration) => declaration.property), [
    'opacity',
    'opacity',
  ]);
});

test('at-rules holding declarations directly are handled', () => {
  const scan = scanCss('@font-face { font-family: "Brand"; src: url("b.woff2") }');
  assert.deepEqual(scan.declarations.map((declaration) => declaration.property), [
    'font-family',
    'src',
  ]);
});

test('nested rules are found and the ampersand survives', () => {
  const scan = scanCss('.outer { color: red; & .inner { color: blue } }');
  assert.deepEqual(scan.rules.map((rule) => rule.selectors), [['& .inner'], ['.outer']]);
});

test('braces inside strings do not end a rule', () => {
  const scan = scanCss('.a { content: "} not a brace {"; color: red }');
  assert.equal(scan.rules.length, 1);
  assert.deepEqual(scan.rules[0].declarations.map((declaration) => declaration.property), [
    'content',
    'color',
  ]);
});

test('braces and semicolons inside url() do not end anything', () => {
  const scan = scanCss('.a { background: url("a}b;c.png"); color: red }');
  assert.deepEqual(scan.rules[0].declarations.map((declaration) => declaration.value), [
    'url("a}b;c.png")',
    'red',
  ]);
});

test('comments are reported and stripped out of values', () => {
  const scan = scanCss('/* top */ .a { color: /* mid */ red; }');
  assert.equal(scan.comments.length, 2);
  assert.equal(scan.rules[0].declarations[0].value, 'red');
});

test('a malformed declaration does not take the rest of the rule with it', () => {
  const scan = scanCss('.a { color red; float: left; display: grid }');
  assert.deepEqual(scan.rules[0].declarations.map((declaration) => declaration.property), [
    'float',
    'display',
  ]);
});

test('an unclosed block still yields what it contained', () => {
  const scan = scanCss('@media (max-width: 600px) { .a { display: flex;');
  assert.deepEqual(declarationsIn(scan.rules.length ? '@media (max-width: 600px) { .a { display: flex;' : ''), [
    'display:flex',
  ]);
  assert.deepEqual(scan.atRules.map((rule) => rule.name), ['media']);
});

test('scanning never throws, whatever the input', () => {
  const nasty = [
    '',
    '}',
    '{',
    '.a {',
    '.a { color',
    '.a { color:',
    '@media',
    '@media {',
    '/* unterminated',
    '.a { content: "unterminated',
    '.a { background: url(',
    ';;;;',
    '.a {;;}',
    '@',
  ];
  for (const css of nasty) {
    assert.doesNotThrow(() => scanCss(css), `threw on ${JSON.stringify(css)}`);
  }
});

test('style attributes parse as a bare declaration list', () => {
  const declarations = scanStyleAttribute('display:flex; border-radius:8px');
  assert.deepEqual(
    declarations.map((declaration) => [declaration.property, declaration.value]),
    [
      ['display', 'flex'],
      ['border-radius', '8px'],
    ],
  );
});

test('style attribute offsets point at the declaration', () => {
  const value = 'color: red; float: left';
  const [, second] = scanStyleAttribute(value);
  assert.equal(value.slice(second.start, second.end), 'float: left');
});

test('a malformed style attribute yields the declarations around it', () => {
  // Upstream threw here, and because `caniemail()` had no try/catch the throw
  // took the entire lint with it — every client, every finding.
  assert.deepEqual(
    scanStyleAttribute('not-a-declaration').map((declaration) => declaration.property),
    [],
  );
  assert.deepEqual(
    scanStyleAttribute('color:red; not-a-declaration; float:left').map((d) => d.property),
    ['color', 'float'],
  );
  assert.deepEqual(scanStyleAttribute('margin:0;;padding:0;').map((d) => d.property), [
    'margin',
    'padding',
  ]);
});

test('property names are lowercased, values are not', () => {
  const [declaration] = scanStyleAttribute('MIX-BLEND-MODE:MULTIPLY');
  assert.equal(declaration.property, 'mix-blend-mode');
  assert.equal(declaration.value, 'MULTIPLY');
});

test('splitTopLevel respects strings, groups and brackets', () => {
  assert.deepEqual(splitTopLevel('.a, .b', ','), ['.a', ' .b']);
  assert.deepEqual(splitTopLevel(':not(.a, .b)', ','), [':not(.a, .b)']);
  assert.deepEqual(splitTopLevel('[title="a,b"]', ','), ['[title="a,b"]']);
});
