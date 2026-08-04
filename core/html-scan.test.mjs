/**
 * HTML scanner.
 *
 * The scanner is flat by design — feature detection examines each element in
 * isolation, so there is no tree to get wrong. What there is to get wrong is
 * everything email markup does to a tokenizer: unclosed tags, unquoted values,
 * a raw `<` inside an attribute, conditional comments, and script bodies that
 * contain markup which must never be treated as markup.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { scanHtml } from './html-scan.mjs';

const tags = (html) => scanHtml(html).elements.map((element) => element.tagName);
const attributesOf = (html, index = 0) =>
  Object.fromEntries(
    scanHtml(html).elements[index].attributes.map((attribute) => [attribute.name, attribute.value]),
  );

test('elements carry their span, from "<" to the last character', () => {
  const html = '<div class="x">hi</div>';
  const [element] = scanHtml(html).elements;
  assert.equal(element.tagName, 'div');
  assert.equal(element.start, 0);
  assert.equal(element.end, html.length - 1);
  assert.equal(html[element.end], '>');
});

test('attribute values are read in every quoting style', () => {
  assert.deepEqual(attributesOf('<div a="one" b=\'two\' c=three d>x</div>'), {
    a: 'one',
    b: 'two',
    c: 'three',
    d: '',
  });
});

test('attribute names are lowercased and their values are not', () => {
  assert.deepEqual(attributesOf('<DIV STYLE="MIX-BLEND-MODE:MULTIPLY">x</DIV>'), {
    style: 'MIX-BLEND-MODE:MULTIPLY',
  });
  assert.deepEqual(tags('<DIV></DIV>'), ['div']);
});

test('a raw "<" inside an attribute value does not start a tag', () => {
  assert.deepEqual(attributesOf('<a href="/search?q=a<b">x</a>'), { href: '/search?q=a<b' });
  assert.deepEqual(tags('<a href="/search?q=a<b">x</a>'), ['a']);
});

test('quotes nested inside the other quote survive', () => {
  assert.deepEqual(attributesOf(`<a href='He said "hi"'>x</a>`), { href: 'He said "hi"' });
});

test('a repeated attribute keeps the first value, as browsers do', () => {
  assert.deepEqual(attributesOf('<div style="color:red" style="color:blue">x</div>'), {
    style: 'color:red',
  });
});

test('attributes may be spread across lines', () => {
  const html = '<div\n  style="border-radius:4px"\n  class="wrapped">x</div>';
  assert.deepEqual(attributesOf(html), { style: 'border-radius:4px', class: 'wrapped' });
});

test('the style attribute reports where its value starts', () => {
  const html = '<td style="color:red">x</td>';
  const [element] = scanHtml(html).elements;
  const style = element.attributes.find((attribute) => attribute.name === 'style');
  assert.equal(html.slice(style.valueStart, style.valueStart + style.value.length), 'color:red');
});

test('void and self-closing elements end at their own ">"', () => {
  const html = '<img src="x.png"/><br/><hr>';
  const elements = scanHtml(html).elements;
  assert.deepEqual(elements.map((element) => element.tagName), ['img', 'br', 'hr']);
  for (const element of elements) assert.equal(html[element.end], '>');
});

test('unclosed elements run to the end of the document', () => {
  const html = '<div><p>text';
  const elements = scanHtml(html).elements;
  assert.deepEqual(elements.map((element) => element.tagName), ['div', 'p']);
  for (const element of elements) assert.equal(element.end, html.length - 1);
});

test('a closing tag with nothing open is ignored', () => {
  assert.deepEqual(tags('</div><p>x</p>'), ['p']);
});

test('raw-text elements do not yield the markup inside them', () => {
  // A `document.write("<div ...>")` in an email's script is not a div.
  const html = '<script>if (1 < 2) document.write("<div style=\'float:left\'>")</script><p>x</p>';
  assert.deepEqual(tags(html), ['script', 'p']);
  const html2 = '<textarea><div style="display:flex"></textarea><span>x</span>';
  assert.deepEqual(tags(html2), ['textarea', 'span']);
  assert.deepEqual(tags('<title>a <b> c</title><p>x</p>'), ['title', 'p']);
});

test('style blocks report the span of their text, not of the tag', () => {
  const html = '<style>.a { color: red }</style>';
  const [block] = scanHtml(html).styleBlocks;
  assert.equal(html.slice(block.textStart, block.textEnd), '.a { color: red }');
});

test('a style block inside a conditional comment is not a style block', () => {
  const html = '<!--[if mso]><style>.a { display: flex }</style><![endif]-->';
  const scan = scanHtml(html);
  assert.equal(scan.styleBlocks.length, 0);
  assert.equal(scan.comments.length, 1);
  assert.equal(scan.elements.length, 0);
});

test('conditional comments are comments, contents and all', () => {
  const html = '<!--[if mso]><table><tr><td>Outlook</td></tr></table><![endif]--><p>x</p>';
  const scan = scanHtml(html);
  assert.equal(scan.comments.length, 1);
  assert.equal(html[scan.comments[0].end], '>');
  assert.deepEqual(scan.elements.map((element) => element.tagName), ['p']);
});

test('the downlevel-revealed conditional leaves its body as real markup', () => {
  // `<!--[if !mso]><!-->` closes, so what follows is markup for everyone else.
  const html = '<!--[if !mso]><!--><div style="color:red">x</div><!--<![endif]-->';
  const scan = scanHtml(html);
  assert.deepEqual(scan.elements.map((element) => element.tagName), ['div']);
  assert.equal(scan.comments.length, 2);
});

test('an unterminated comment swallows the rest of the document', () => {
  const scan = scanHtml('<p>x</p><!-- never closed <div>');
  assert.deepEqual(scan.elements.map((element) => element.tagName), ['p']);
  assert.equal(scan.comments.length, 1);
});

test('the doctype is reported, and only a real doctype', () => {
  assert.equal(scanHtml('<!DOCTYPE html>\n<html></html>').doctypes.length, 1);
  assert.equal(scanHtml('<!-- comment --><p>x</p>').doctypes.length, 0);
  const xhtml = scanHtml(
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://x">',
  );
  assert.equal(xhtml.doctypes.length, 1, 'an XHTML doctype is still a doctype node');
});

test('non-ASCII attribute names are read', () => {
  // AMP for Email is declared as `<html ⚡4email>`.
  assert.deepEqual(Object.keys(attributesOf('<html ⚡4email><body>x</body></html>')), ['⚡4email']);
});

test('scanning never throws, whatever the input', () => {
  const nasty = [
    '',
    '<',
    '<<<',
    '<div',
    '<div attr=',
    '<div attr="unterminated',
    "<div attr='unterminated",
    '</>',
    '<!',
    '<!--',
    '<?xml version="1.0"?>',
    '<style>',
    '<script>',
    '<a href=">">x</a>',
  ];
  for (const html of nasty) {
    assert.doesNotThrow(() => scanHtml(html), `threw on ${JSON.stringify(html)}`);
  }
});
