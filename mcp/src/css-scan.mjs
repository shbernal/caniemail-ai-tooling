/**
 * caniemail-ai-tooling — CSS scanner.
 *
 * Tolerant recursive descent producing rules, declarations, at-rules and
 * comments with offsets. Malformed input degrades; nothing here throws.
 * Email CSS is routinely truncated, doubly-escaped or hand-edited, and a
 * parser that gives up on the first bad declaration reports nothing at all.
 *
 * Two behaviours are deliberate departures from the `caniemail` package, which
 * parsed only the top level of a stylesheet:
 *
 * 1. At-rule blocks are descended into. `@media` is where email authors put
 *    their responsive CSS, and upstream never looked inside one — a
 *    `border-radius` appearing only in a media query was invisible.
 * 2. At-rules carry positions, so a finding about `@supports` can be pointed at.
 *
 * Offsets are 0-based indexes into the source. Following the convention the
 * previous implementation's positions were expressed in, a declaration's `end`
 * is the offset of its terminating `;` or `}`, and a rule's `end` is one past
 * its closing `}`.
 *
 * Vendored byte-identically into `skill/scripts/` and `mcp/src/`; never edit a
 * vendored copy, edit this file and run `make sync-core`.
 */

const COMMENT_PATTERN = /\/\*[^]*?(?:\*\/|$)/g;
const PROPERTY_CHAR = /[*#/\\\w-]/;

/**
 * @typedef {object} ScannedDeclaration
 * @property {string} property
 * @property {string} value
 * @property {number} start  Offset of the property's first character.
 * @property {number} end    Offset of the terminating `;` or `}`.
 */

/**
 * @typedef {object} ScannedRule
 * @property {string[]} selectors  Comma-split, trimmed.
 * @property {ScannedDeclaration[]} declarations
 * @property {number} start        Offset of the selector's first character.
 * @property {number} end          One past the closing `}`.
 */

/**
 * @typedef {object} CssScan
 * @property {ScannedRule[]} rules              Including rules nested in at-rules.
 * @property {ScannedDeclaration[]} declarations Declarations not inside a style rule.
 * @property {{name: string, prelude: string, start: number, end: number}[]} atRules
 * @property {{start: number, end: number}[]} comments
 */

/**
 * Scan a stylesheet.
 *
 * @param {string} source
 * @returns {CssScan}
 */
export function scanCss(source) {
  const out = { rules: [], declarations: [], atRules: [], comments: collectComments(source) };
  parseStatements(source, 0, source.length, out, out.declarations, false);
  return out;
}

/**
 * Every comment in the source, in one pass.
 *
 * Done separately from the statement loop because comments are legal
 * everywhere — between declarations, inside a value, inside a selector, inside
 * an at-rule prelude — and only the ones between declarations survive being
 * found structurally. Strings are stepped over, so a comment opener sitting
 * inside a quoted `content` value is not a comment.
 */
function collectComments(source) {
  const comments = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (char === '\\') {
      i += 2;
    } else if (char === '"' || char === "'") {
      i = skipString(source, i, source.length);
    } else if (char === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      const end = close === -1 ? source.length : close + 2;
      comments.push({ start: i, end });
      i = end;
    } else {
      i += 1;
    }
  }
  return comments;
}

/**
 * Scan the contents of a `style=""` attribute.
 *
 * A style attribute is a declaration list with no surrounding block, so it gets
 * the declaration loop and nothing else. Offsets are relative to `text`.
 *
 * @param {string} text
 * @returns {ScannedDeclaration[]}
 */
export function scanStyleAttribute(text) {
  const declarations = [];
  parseDeclarationList(text, 0, text.length, declarations);
  return declarations;
}

/**
 * Parse a sequence of statements until `}` or `limit`.
 *
 * @param {boolean} inKeyframes Suppresses rule records: `from`/`to`/`50%` are
 *   keyframe selectors, not CSS selectors, and reporting `from` as a type
 *   selector would be a pure false positive.
 * @returns {number} Offset of the `}` that ended the block, or `limit`.
 */
function parseStatements(source, from, limit, out, declarationSink, inKeyframes) {
  let i = from;

  while (i < limit) {
    i = skipWhitespace(source, i, limit);
    if (i >= limit) break;

    const char = source[i];
    if (char === '}') return i;

    if (char === '/' && source[i + 1] === '*') {
      // Already recorded by `collectComments`; just step over it.
      i = skipComment(source, i, limit);
      continue;
    }

    if (char === '@') {
      const next = parseAtRule(source, i, limit, out, inKeyframes);
      if (next > i) {
        i = next;
        continue;
      }
    }

    if (startsRule(source, i, limit)) {
      const next = parseRule(source, i, limit, out, inKeyframes);
      if (next > i) {
        i = next;
        continue;
      }
    }

    const declaration = parseDeclaration(source, i, limit);
    if (declaration) {
      declarationSink.push(declaration);
      i = skipTerminators(source, declaration.end, limit);
      continue;
    }

    // Malformed. Skip to the next `;` inside this block, or hand the `}` back
    // to the caller. Recovering rather than bailing is what keeps one bad
    // declaration from voiding an entire stylesheet.
    const stop = scanForward(source, i, limit, ';}');
    if (stop === -1) return limit;
    if (source[stop] === '}') return stop;
    i = stop + 1;
  }

  return limit;
}

/**
 * Does a rule start here?
 *
 * A `{` reached before any `;` or `}` means a selector and a block; anything
 * else is a declaration. This is the same test the previous parser used, and it
 * is what lets declarations and nested rules coexist inside one block.
 */
function startsRule(source, from, limit) {
  const brace = scanForward(source, from, limit, '{');
  if (brace === -1) return false;
  const terminator = scanForward(source, from, limit, ';}');
  return terminator === -1 || brace < terminator;
}

function parseRule(source, from, limit, out, inKeyframes) {
  const brace = scanForward(source, from, limit, '{');
  if (brace === -1) return from;

  const selectors = splitTopLevel(stripComments(source.slice(from, brace)).trim(), ',')
    .map((selector) => selector.trim())
    .filter(Boolean);

  const declarations = [];
  const closing = parseStatements(source, brace + 1, limit, out, declarations, inKeyframes);
  const end = source[closing] === '}' ? closing + 1 : closing;

  if (inKeyframes) {
    // Keep the declarations, drop the selector: a keyframe stop is not a
    // selector and must not reach the selector-shape detectors.
    out.declarations.push(...declarations);
  } else {
    out.rules.push({ selectors, declarations, start: from, end });
  }
  return end;
}

function parseAtRule(source, from, limit, out, inKeyframes) {
  let i = from + 1;
  const nameStart = i;
  while (i < limit && /[-\w]/.test(source[i])) i += 1;
  if (i === nameStart) return from;

  // `@-webkit-keyframes` is `@keyframes`. Vendor prefixes are noise here: the
  // dataset has no title for a prefixed at-rule.
  const name = source.slice(nameStart, i).toLowerCase().replace(/^-[a-z]+-/, '');

  const stop = scanForward(source, i, limit, '{;');
  const preludeEnd = stop === -1 ? limit : stop;
  const prelude = stripComments(source.slice(i, preludeEnd)).trim();

  let end;
  if (stop !== -1 && source[stop] === '{') {
    // `@font-face`, `@page` and friends hold declarations directly; `@media`
    // and `@supports` hold rules. Both are handled by the same loop.
    const closing = parseStatements(
      source,
      stop + 1,
      limit,
      out,
      out.declarations,
      inKeyframes || name === 'keyframes',
    );
    end = source[closing] === '}' ? closing + 1 : closing;
  } else if (stop !== -1) {
    end = stop + 1;
  } else {
    end = limit;
  }

  out.atRules.push({ name, prelude, start: from, end });
  return end;
}

/** Parse declarations until `}` or `limit`, with no rule or at-rule handling. */
function parseDeclarationList(source, from, limit, sink) {
  let i = from;
  while (i < limit) {
    i = skipWhitespace(source, i, limit);
    if (i >= limit || source[i] === '}') break;

    if (source[i] === '/' && source[i + 1] === '*') {
      i = skipComment(source, i, limit);
      continue;
    }

    const declaration = parseDeclaration(source, i, limit);
    if (declaration) {
      sink.push(declaration);
      i = skipTerminators(source, declaration.end, limit);
      continue;
    }

    const stop = scanForward(source, i, limit, ';}');
    if (stop === -1 || source[stop] === '}') break;
    i = stop + 1;
  }
}

/** @returns {ScannedDeclaration|null} */
function parseDeclaration(source, from, limit) {
  let i = from;
  if (source[i] === '*') i += 1; // The `*property` IE hack.
  const nameStart = i;
  while (i < limit && PROPERTY_CHAR.test(source[i])) i += 1;
  if (i === nameStart) return null;

  // An IE filter hack such as `filter[foo]`.
  if (source[i] === '[') {
    const close = source.indexOf(']', i);
    if (close !== -1 && close < limit) i = close + 1;
  }

  const property = stripComments(source.slice(from, i)).trim().toLowerCase();
  i = skipWhitespace(source, i, limit);
  if (source[i] !== ':') return null;
  i = skipWhitespace(source, i + 1, limit);

  const terminator = scanForward(source, i, limit, ';}');
  const valueEnd = terminator === -1 ? limit : terminator;
  const value = stripComments(source.slice(i, valueEnd)).trim();

  return { property, value, start: from, end: valueEnd };
}

function skipTerminators(source, from, limit) {
  let i = from;
  while (i < limit && (source[i] === ';' || isWhitespace(source[i]))) i += 1;
  return i;
}

function skipWhitespace(source, from, limit) {
  let i = from;
  while (i < limit && isWhitespace(source[i])) i += 1;
  return i;
}

function isWhitespace(char) {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';
}

/**
 * Offset of the first character in `stopChars` that is not inside a string,
 * comment, parenthesised group or bracketed group. -1 if there is none.
 *
 * Every caller depends on this: `content: "} not a brace {"` must not end its
 * rule, `:not(.a, .b)` must not split into two selectors, and `[title="a > b"]`
 * must not read as a child combinator.
 */
function scanForward(source, from, limit, stopChars) {
  let i = from;
  while (i < limit) {
    const char = source[i];
    if (stopChars.includes(char)) return i;
    switch (char) {
      case '\\':
        i += 2;
        break;
      case '"':
      case "'":
        i = skipString(source, i, limit);
        break;
      case '(':
        i = skipNested(source, i, limit, '(', ')');
        break;
      case '[':
        i = skipNested(source, i, limit, '[', ']');
        break;
      case '/':
        i = source[i + 1] === '*' ? skipComment(source, i, limit) : i + 1;
        break;
      default:
        i += 1;
    }
  }
  return -1;
}

function skipString(source, from, limit) {
  const quote = source[from];
  let i = from + 1;
  while (i < limit) {
    if (source[i] === '\\') {
      i += 2;
      continue;
    }
    if (source[i] === quote) return i + 1;
    i += 1;
  }
  return limit;
}

function skipComment(source, from, limit) {
  const close = source.indexOf('*/', from + 2);
  return close === -1 || close >= limit ? limit : close + 2;
}

function skipNested(source, from, limit, open, close) {
  let depth = 0;
  let i = from;
  while (i < limit) {
    const char = source[i];
    if (char === '\\') {
      i += 2;
      continue;
    }
    if (char === '"' || char === "'") {
      i = skipString(source, i, limit);
      continue;
    }
    if (char === '/' && source[i + 1] === '*') {
      i = skipComment(source, i, limit);
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return limit;
}

/** Split on a separator that is not inside a string, group or comment. */
export function splitTopLevel(text, separator) {
  const parts = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const at = scanForward(text, i, text.length, separator);
    if (at === -1) break;
    parts.push(text.slice(start, at));
    start = at + 1;
    i = at + 1;
  }
  parts.push(text.slice(start));
  return parts;
}

function stripComments(text) {
  return text.replace(COMMENT_PATTERN, '');
}
