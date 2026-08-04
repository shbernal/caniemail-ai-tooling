/**
 * caniemail-ai-tooling — feature title tables.
 *
 * Turns the dataset's feature *titles* into the things a parser can match:
 * property names, units, keywords, at-rule names, element names, attributes.
 *
 * The tables are derived from the titles by convention — `title.endsWith(' unit')`,
 * `title.startsWith('@')`, `/<(\w+)>/` and so on — exactly as the `caniemail`
 * package did, and for the same reason: a static list would rot the moment
 * upstream adds a feature. What is hardcoded is only the set of titles whose
 * shape breaks the convention, and each of those carries a comment naming it.
 *
 * The tables are built per dataset and memoised, because the dataset is fetched
 * at runtime rather than bundled — there is no module-load-time snapshot to
 * build them from.
 *
 * Vendored byte-identically into `skill/scripts/` and `mcp/src/`; never edit a
 * vendored copy, edit this file and run `make sync-core`.
 */

/* -------------------------------------------------------------------------- */
/* Hardcoded shape exceptions                                                  */
/* -------------------------------------------------------------------------- */

/**
 * CSS titles that name several properties instead of one.
 *
 * Every entry exists because the title is prose ("border-inline & border-block")
 * rather than a property name, so `/^[a-z-]+$/` cannot recover it.
 */
const PROPERTY_TITLE_EXCEPTIONS = {
  'block-size & inline-size': ['block-size', 'inline-size'],
  'border-inline & border-block': ['border-inline', 'border-block'],
  'border-inline & border-block individual logical properties': [
    'border-block-end',
    'border-block-start',
    'border-inline-end',
    'border-inline-start',
  ],
  'border-inline & border-block longhand properties': [
    'border-block-color',
    'border-block-style',
    'border-block-width',
    'border-inline-color',
    'border-inline-style',
    'border-inline-width',
  ],
  'border-radius logical properties': [
    'border-end-end-radius',
    'border-end-start-radius',
    'border-start-end-radius',
    'border-start-start-radius',
  ],
  'color-scheme CSS property': ['color-scheme'],
  'css column properties': [
    'column-count',
    'column-fill',
    'column-gap',
    'column-rule',
    'column-rule-color',
    'column-rule-style',
    'column-rule-width',
    'column-span',
    'column-width',
    'columns',
  ],
  'gap, column-gap, row-gap': ['column-gap', 'gap', 'row-gap'],
  'grid-template-* properties': [
    'grid-template',
    'grid-template-areas',
    'grid-template-columns',
    'grid-template-rows',
  ],
  'left, right, top, bottom': ['left', 'right', 'top', 'bottom'],
  'margin-block-start & margin-block-end': ['margin-block-end', 'margin-block-start'],
  'margin-inline & margin-block': ['margin-block', 'margin-inline'],
  'margin-inline-start & margin-inline-end': ['margin-inline-end', 'margin-inline-start'],
  'padding-block-start & padding-block-end': ['padding-block-end', 'padding-block-start'],
  'padding-inline & padding-block': ['padding-block', 'padding-inline'],
  'padding-inline-start & padding-inline-end': ['padding-inline-end', 'padding-inline-start'],
};

/**
 * CSS titles that name a set of *values* rather than a property or a pair.
 * Matched as whole words anywhere in a declaration value.
 */
const VALUE_TITLE_EXCEPTIONS = {
  'fit-content, min-content, max-content': ['fit-content', 'max-content', 'min-content'],
  'system-ui, ui-serif, ui-sans-serif, ui-rounded, ui-monospace': [
    'system-ui',
    'ui-monospace',
    'ui-rounded',
    'ui-sans-serif',
    'ui-serif',
  ],
};

/**
 * HTML titles that name elements the `/<(\w+)>/` convention cannot recover.
 */
const ELEMENT_TITLE_EXCEPTIONS = {
  // Bare word, no angle brackets.
  address: ['address'],
  // A range, not a list: the convention would recover h1 and h6 and drop h2-h5.
  '<h1> to <h6> elements': ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
  // The doctype is a directive, not a tag; `detectHtml` matches it specially.
  'HTML5 doctype': [],
  // Prose title covering the whole HTML5 sectioning/semantic element set.
  'HTML5 semantics': [
    'article',
    'aside',
    'details',
    'figcaption',
    'figure',
    'footer',
    'header',
    'main',
    'mark',
    'nav',
    'section',
    'summary',
    'time',
  ],
  // "Image maps" is <map>, and the title does not say so.
  'Image maps': ['map'],
  // The <svg> in the title is context; the element measured is SVG's <image>.
  'Embedded <svg> image': ['image'],
};

/**
 * HTML titles that pair an element with an attribute, where the pairing is not
 * spelled `<el attr="value">`.
 */
const ELEMENT_ATTRIBUTE_TITLE_EXCEPTIONS = {
  'Local anchors': { element: 'a', matchers: [['href', /^#/], ['name', null]] },
  'mailto: links': { element: 'a', matchers: [['href', /^mailto:/i]] },
  'color-scheme meta tag': { element: 'meta', matchers: [['name', 'color-scheme']] },
  'AMP for Email': { element: 'html', matchers: [['⚡4email', null], ['amp4email', null]] },
};

/** HTML titles naming several attributes at once. */
const ATTRIBUTE_TITLE_EXCEPTIONS = {
  'srcset and sizes attributes': ['srcset', 'sizes'],
};

/** File extension -> image feature title. */
const IMAGE_EXTENSION_TITLES = {
  apng: 'Animated PNG image format',
  avif: 'AVIF image format',
  bmp: 'BMP image format',
  gif: 'GIF image format',
  heic: 'HEIF image format',
  heif: 'HEIF image format',
  ico: 'ICO image format',
  jpeg: 'JPG image format',
  jpg: 'JPG image format',
  png: 'PNG image format',
  svg: 'SVG image format',
  tif: 'TIFF image format',
  tiff: 'TIFF image format',
  webp: 'webP image format',
};

/** data: URI MIME type -> image feature title. */
const IMAGE_MIME_TITLES = {
  'image/apng': 'Animated PNG image format',
  'image/avif': 'AVIF image format',
  'image/bmp': 'BMP image format',
  'image/gif': 'GIF image format',
  'image/heic': 'HEIF image format',
  'image/heif': 'HEIF image format',
  'image/jpeg': 'JPG image format',
  'image/jpg': 'JPG image format',
  'image/png': 'PNG image format',
  'image/svg+xml': 'SVG image format',
  'image/tiff': 'TIFF image format',
  'image/vnd.microsoft.icon': 'ICO image format',
  'image/webp': 'webP image format',
};

/** Titles that name a selector shape rather than anything textual. */
export const SELECTOR_SHAPE_TITLES = [
  'Adjacent sibling combinator',
  'Attribute selector',
  'Chaining selectors',
  'Child combinator',
  'Class selector',
  'Descendant combinator',
  'General sibling combinator',
  'Grouping selectors',
  'ID selector',
  'Type selector',
  'Universal selector *',
];

/** Titles raised by a construct with no name of its own. */
export const CSS_COMMENTS_TITLE = 'CSS comments';
export const CSS_NESTING_TITLE = 'CSS Nesting';
export const HTML_COMMENTS_TITLE = 'HTML comments';
export const HTML_DOCTYPE_TITLE = 'HTML5 doctype';

/* -------------------------------------------------------------------------- */
/* Table construction                                                          */
/* -------------------------------------------------------------------------- */

const PROPERTY_NAME = /^[a-z-]+$/;

const cache = new WeakMap();

/**
 * Build the title tables for a dataset's feature list.
 *
 * Memoised on the feature array, which `loadDataset` creates once per dataset,
 * so repeated lints against the same dataset build the tables once.
 *
 * @param {object[]} features Raw feature records.
 */
export function buildTitleTables(features) {
  const cached = cache.get(features);
  if (cached) return cached;
  const tables = createTables(features);
  cache.set(features, tables);
  return tables;
}

function createTables(features) {
  const titlesByCategory = { css: [], html: [], image: [], others: [] };
  const known = new Set();
  for (const feature of features) {
    known.add(feature.title);
    const bucket = titlesByCategory[feature.category];
    if (bucket) bucket.push(feature.title);
  }

  const css = titlesByCategory.css;
  // "AMP for Email" is categorised `others` but is detected from markup, so it
  // joins the HTML titles. This mirrors upstream, which does the same.
  const html = [...titlesByCategory.html, ...['AMP for Email'].filter((t) => known.has(t))];

  return {
    known,

    /* CSS ---------------------------------------------------------------- */

    // "@media" -> "media". Media-feature titles keep their parenthesised part,
    // which `matchAtRule` matches against the at-rule prelude.
    atRules: css.filter((t) => t.startsWith('@')).map((title) => ({
      title,
      names: [...title.matchAll(/@([a-z-]+)/g)].map((m) => m[1]),
      features: [...title.matchAll(/\(([a-z-]+)\)/g)].map((m) => m[1]),
    })),

    // "linear-gradient()" -> "linear-gradient". A title may name several
    // functions ("lch(), oklch(), lab(), oklab()"), so every name is taken.
    functions: css.flatMap((title) => {
      if (title.startsWith(':')) return []; // ":has()" is a pseudo-class.
      // The one function whose title does not spell it with parentheses.
      if (title === 'CSS Variables (Custom Properties)') return [{ title, names: ['var'] }];
      if (!title.includes('()')) return [];
      const names = [...title.matchAll(/([a-z-]+)\(\)/g)].map((m) => m[1]);
      return names.length > 0 ? [{ title, names }] : [];
    }),

    // "!important keyword" -> "!important".
    keywords: css
      .filter((t) => t.includes(' keyword'))
      .map((title) => ({ title, value: title.replace(/ keyword$/, '') })),

    // "display:flex" -> property "display", value "flex".
    propertyValuePairs: css.flatMap((title) => {
      const match = /([a-z-]+):\s*([a-z-]+)/.exec(title);
      return match ? [{ title, property: match[1], value: match[2] }] : [];
    }),

    // "height property" / "font shorthand" / "inline-size " -> one property.
    properties: css.flatMap((title) => {
      const exception = PROPERTY_TITLE_EXCEPTIONS[title];
      if (exception) return [{ title, names: exception }];
      const trimmed = title.trim().replace(/ shorthand$/, '').replace(/ property$/, '');
      return PROPERTY_NAME.test(trimmed) ? [{ title, names: [trimmed] }] : [];
    }),

    // "px unit" -> "px".
    units: css
      .filter((t) => t.endsWith(' unit'))
      .map((title) => ({ title, unit: title.replace(/ unit$/, '') })),

    values: Object.entries(VALUE_TITLE_EXCEPTIONS)
      .filter(([title]) => known.has(title))
      .map(([title, names]) => ({ title, names })),

    // "::after" / ":nth-child" / ":has()" -> the pseudo's bare name.
    pseudos: css
      .filter((t) => t.startsWith(':'))
      .map((title) => ({ title, name: title.replace(/^:+/, '').replace(/\(\)$/, '') })),

    selectorShapes: new Set(SELECTOR_SHAPE_TITLES.filter((t) => known.has(t))),

    /* HTML --------------------------------------------------------------- */

    // "<video> element" -> "video"; "<ul>, <ol> and <dl>" -> all three.
    elements: html.flatMap((title) => {
      const exception = ELEMENT_TITLE_EXCEPTIONS[title];
      if (exception) return exception.length > 0 ? [{ title, names: exception }] : [];
      const names = [...title.matchAll(/<(\w+)>/g)].map((m) => m[1].toLowerCase());
      return names.length > 0 ? [{ title, names }] : [];
    }),

    // "role attribute" -> "role".
    attributes: html.flatMap((title) => {
      const exception = ATTRIBUTE_TITLE_EXCEPTIONS[title];
      if (exception) return [{ title, names: exception }];
      if (!title.endsWith(' attribute')) return [];
      return [{ title, names: [title.replace(/ attribute$/, '')] }];
    }),

    // '<input type="text"> element' -> element "input", attribute type="text".
    elementAttributes: html.flatMap((title) => {
      const exception = ELEMENT_ATTRIBUTE_TITLE_EXCEPTIONS[title];
      if (exception) return [{ title, ...exception }];
      const match = /<(\w+) ([\w-]+)="([^"]+)"> element/.exec(title);
      if (!match) return [];
      return [
        { title, element: match[1].toLowerCase(), matchers: [[match[2].toLowerCase(), match[3]]] },
      ];
    }),

    /* Images ------------------------------------------------------------- */

    imageExtensions: filterToKnown(IMAGE_EXTENSION_TITLES, known),
    imageMimes: filterToKnown(IMAGE_MIME_TITLES, known),
  };
}

function filterToKnown(map, known) {
  return Object.fromEntries(Object.entries(map).filter(([, title]) => known.has(title)));
}

/* -------------------------------------------------------------------------- */
/* Matchers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Titles matched by a declaration's property name.
 *
 * A property matches its own title and every shorthand title it extends, so
 * `border-radius` reports both `border-radius` and `border`. That is upstream's
 * rule and it is the right one: the shorthand's support data is what an agent
 * needs when the longhand has none.
 */
export function matchProperty(tables, propertyName) {
  const titles = [];
  for (const { title, names } of tables.properties) {
    if (names.some((name) => propertyName === name || propertyName.startsWith(`${name}-`))) {
      titles.push(title);
    }
  }
  return titles;
}

/** Titles matched by a `property: value` pair, ignoring `!important`. */
export function matchPropertyValuePair(tables, propertyName, propertyValue) {
  const value = stripImportant(propertyValue);
  const titles = [];
  for (const pair of tables.propertyValuePairs) {
    if (pair.property === propertyName && pair.value === value) titles.push(pair.title);
  }
  return titles;
}

/** Titles matched by function calls appearing in a declaration value. */
export function matchFunctions(tables, propertyValue) {
  // No whitespace before the paren: CSS functional notation does not allow it,
  // and permitting it turns `Arial (fallback)` into a function call.
  const called = new Set([...propertyValue.matchAll(/([a-z-]+)\(/gi)].map((m) => m[1].toLowerCase()));
  return tables.functions.filter((f) => f.names.some((n) => called.has(n))).map((f) => f.title);
}

/** Titles matched by a keyword appearing in a declaration value. */
export function matchKeywords(tables, propertyValue) {
  return tables.keywords.filter((k) => propertyValue.includes(k.value)).map((k) => k.title);
}

/** Titles matched by a bare value keyword, as a whole word. */
export function matchValues(tables, propertyValue) {
  const titles = [];
  for (const { title, names } of tables.values) {
    if (names.some((name) => new RegExp(`(^|[\\s,])${escapeRegExp(name)}([\\s,]|$)`).test(propertyValue))) {
      titles.push(title);
    }
  }
  return titles;
}

/**
 * Titles matched by a unit appearing in a declaration value.
 *
 * A unit only counts immediately after a digit, so `margin: 0` does not report
 * the `in` unit and `1rem` does not report `em`. `initial` is a keyword rather
 * than a suffix, so it matches on a word boundary instead.
 */
export function matchUnits(tables, propertyValue) {
  const titles = [];
  for (const { title, unit } of tables.units) {
    // Immediately after the digit, with nothing between: `content: "1 inch"`
    // is not an `in` unit.
    const pattern = unit === 'initial' ? /\binitial\b/ : new RegExp(`\\d${escapeRegExp(unit)}`);
    if (pattern.test(propertyValue)) titles.push(title);
  }
  return titles;
}

/**
 * Titles matched by an at-rule.
 *
 * `@media` matches on the name alone. A media-feature title such as
 * `@media (prefers-color-scheme)` additionally requires that feature to appear
 * in the at-rule's prelude, which is what makes those five titles reachable —
 * upstream compared them against bare node type names, so they never matched.
 */
export function matchAtRule(tables, name, prelude = '') {
  const titles = [];
  for (const rule of tables.atRules) {
    if (!rule.names.includes(name)) continue;
    if (rule.features.length > 0 && !rule.features.some((f) => prelude.includes(f))) continue;
    titles.push(rule.title);
  }
  return titles;
}

/** Titles matched by a pseudo-class or pseudo-element name. */
export function matchPseudo(tables, pseudoName) {
  return tables.pseudos.filter((p) => p.name === pseudoName).map((p) => p.title);
}

/** Titles matched by a tag name. */
export function matchElement(tables, tagName) {
  return tables.elements.filter((e) => e.names.includes(tagName)).map((e) => e.title);
}

/** Titles matched by the attribute names present on an element. */
export function matchAttributes(tables, attributeNames) {
  return tables.attributes
    .filter((a) => a.names.some((name) => attributeNames.includes(name)))
    .map((a) => a.title);
}

/**
 * Titles matched by an element/attribute pairing.
 *
 * A matcher is `[name, expected]`: a null `expected` means the attribute only
 * has to be present, a string means equality, a RegExp means a value test.
 * String comparison is case-insensitive because every value spelled in a title
 * is an HTML keyword (`type="checkbox"`, `name="color-scheme"`), and HTML
 * compares those without regard to case. The RegExp matchers carry their own
 * flags, since `href` values are not keywords.
 *
 * @param {object} tables
 * @param {string} tagName
 * @param {Map<string, string>} attributes
 */
export function matchElementAttributes(tables, tagName, attributes) {
  const titles = [];
  for (const { title, element, matchers } of tables.elementAttributes) {
    if (element !== tagName) continue;
    const hit = matchers.some(([name, expected]) => {
      if (!attributes.has(name)) return false;
      if (expected === null) return true;
      const value = attributes.get(name);
      return expected instanceof RegExp
        ? expected.test(value)
        : value.toLowerCase() === expected.toLowerCase();
    });
    if (hit) titles.push(title);
  }
  return titles;
}

/**
 * The image-format title a URL implies, if any.
 *
 * A data: URI is read from its MIME type; anything else from the extension,
 * after query string and fragment are stripped.
 */
export function matchImageUrl(tables, url) {
  const trimmed = String(url).trim();
  const mime = /^data:([^;,]+)/i.exec(trimmed)?.[1]?.toLowerCase();
  if (mime) return tables.imageMimes[mime];
  const path = trimmed.split(/[?#]/, 1)[0];
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  return extension ? tables.imageExtensions[extension] : undefined;
}

/** The candidate URLs in a `srcset` attribute. */
export function urlsFromSrcset(srcset) {
  return String(srcset)
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/, 1)[0])
    .filter(Boolean);
}

/** The URLs in `url(...)` functions inside a declaration value. */
export function urlsFromCssValue(value) {
  return [...String(value).matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)]
    .map((match) => match[2]?.trim())
    .filter(Boolean);
}

function stripImportant(value) {
  return value.replace(/\s*!\s*important\s*$/i, '').trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
