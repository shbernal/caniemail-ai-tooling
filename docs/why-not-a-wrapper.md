# Why this is not a thin wrapper

The obvious build is a shim over the [`caniemail`](https://github.com/shellscape/caniemail)
npm package, which parses HTML/CSS and reports compatibility issues. This
started as exactly that, and stopped being one for two separate reasons.

## The support resolution is wrong

Three defects, each breaking the part of the dataset an agent needs most:

1. **`untested` is reported as partial support.** `getSupportType` returns
   `'partial'` for anything that is not `y` or `n`, merging `a` (works with a
   workaround) into `u` (never tested). 900 of its 1,637 `partial` verdicts are
   actually untested, 55% of them, across 76 features. They surface as warnings
   with no note, which reads as "minor, proceed".

2. **Version selection sorts keys that were already in order.** The upstream
   JSON preserves the chronological order the site displays; the package
   re-sorts it lexicographically and takes the last. `outlook.macos` carries
   `["2011", "2016", "16.80"]`, where the newest entry sorts smallest, both
   lexicographically and numerically. 280 cells resolve to the wrong version,
   flipping verdicts in both directions.

3. **Missing data throws instead of answering.** 16% of (feature, client) pairs
   have no stats entry, and the package raises `RangeError` rather than treating
   them as untested. On realistic markup 14 of 48 clients crash, and the
   documented `['*']` glob fails unconditionally.

Every verdict is resolved here instead, against the raw dataset, with the four
verdicts intact and no re-sorting. The core suite has a regression test for each.

## The detection was worth owning too

For a while this project kept the package purely as a parser, taking `title` and
`position` from it and discarding every verdict it computed. That worked, and
cost 28 MB of transitive dependencies, an `npm install` in the skill directory,
and a 48-pass parse of every document. The package reports a feature only when
some probed client fails to fully support it, so detection had to run once per
client and be unioned.

Feature detection is now ours. One parse, no dependencies, and no email client
involved in answering "what does this markup use?". Detecting titles directly
finds what the old approach structurally could not:

| Previously undetectable | Why |
|---|---|
| 22 universal features, among them `<div>`, `<table>`, `px unit`, `PNG` | Every client with data rates them `y`, so no probe ever reported them, and the six or seven clients with *no* data never got their `untested` verdict |
| Every CSS function, `calc()`, `min()`, `max()`, `var()`, gradients, `rgb()` | The package's function table is iterated with its key and value transposed, so it matches nothing |
| Anything inside `@media` or `@supports` | Only a stylesheet's top level was walked, and responsive email lives in media queries |
| `HTML5 doctype`, `HTML5 semantics`, `Grouping selectors`, `<h2>` through `<h6>`, `<ol>`, `<dl>` | Dead or partial entries in the title tables |
| `display: none !important` | `!important` was compared as part of the value |

Two further defects were fixes rather than additions. Findings inside a
`<style>` block were reported at their offset *within the block* rather than in
the document, so every one carried a wrong line number. And a single malformed
`style` attribute threw out of `style-to-object` with no `try`/`catch` above it,
killing all 48 client passes and returning a clean bill of health for the entire
email.

The package remains a devDependency, because it is the only independent
implementation of what was ported. The differential suite in
`core/differential.test.mjs` checks every fixture against it. Across the corpus
it finds 267 feature titles and we find 125 more, losing only two, both cases
where its own detection is wrong.

## Data freshness

The dataset is fetched live from caniemail.com rather than read from a bundled
copy, because the package's copy tracks an irregular release cadence, eight
months between two recent releases, and was 68 days behind the site at time of
writing. A snapshot in `core/data/caniemail.json` is the offline fallback, so a
skill copied onto a machine with no network still answers, and every result
names which copy answered.

A live response has to look like the dataset before it is believed. An endpoint
that has moved and says so in valid JSON falls back to the snapshot, rather than
answering every question with an empty matrix and calling it live data.

