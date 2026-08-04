# AGENTS.md

Guidance for AI agents working in this repo.

## What this is

Two surfaces (a Claude skill and an MCP server) over one shared core
(`core/caniemail-core.mjs`) giving an agent access to email client HTML/CSS
compatibility data. See `README.md` for the full pitch and usage.

```
core/     the implementation and its tests — the only real source
skill/    SKILL.md, a CLI, and a vendored copy of the core
mcp/      the mcp-server-caniemail npm package, a thin adapter over the core
```

The shipped core has **zero runtime dependencies**. Node 22+ and nothing else.
That is a property to preserve, not an accident: it is what lets `skill/` run
from a bare checkout with no `package.json` and no install step.

## Pre-release

This project has no release yet. Treat it as free to change:

- Do not preserve backwards compatibility unless Santiago explicitly asks.
- Do not defer to the prior architecture when it conflicts with the current goal.
- Existing code, docs, and plans are context, not constraints.

Once there is a release, compatibility becomes a real constraint and this
section gets replaced with the rules in `rfc-ai-tooling/AGENTS.md`.

## The vendoring rule

`core/` is the single implementation. Everything under `skill/scripts/` and
`mcp/src/` named in the Makefile's `CORE_FILES` is a byte-identical vendored
copy, not independent code:

```
caniemail-core.mjs   dataset loading, resolution, the four tools
detect.mjs           markup -> feature titles, with positions
html-scan.mjs        flat HTML tokenizer
css-scan.mjs         tolerant CSS scanner
selector-shapes.mjs  the eleven selector shapes, plus pseudos
feature-titles.mjs   dataset titles -> matchable names
data/caniemail.json  the offline dataset snapshot
```

- **Never edit a vendored copy directly.** Edit the core, then `make sync-core`.
- `make check-vendor` fails the build on drift, dataset snapshot included.
- Files not in `CORE_FILES` — the tests and `upstream-detect.mjs` — are
  development-only and must never reach a surface.

The core is plain ESM with JSDoc types rather than TypeScript, specifically so
the vendored copies need no build step on either surface. Keep it that way — a
compile step would have to run in both places and the vendoring guarantee would
stop being a byte comparison.

## Commands

```bash
pnpm install        # both package trees at once — see "The package manager"
make test           # core suite, no network
make test-network   # adds the live-fetch test
make sync-core      # copy the core into both surfaces — run after any core edit
make check-vendor   # verify the vendored copies match
make goldens        # regenerate fixtures/expected after an intended change
make refresh-data   # refetch the dataset snapshot
make smoke          # drive the MCP server over real stdio JSON-RPC
```

Run `make sync-core test check-vendor` before committing any core change.

`make test` and `make check-vendor` also run as a lefthook `pre-commit` hook, so
a forgotten `make sync-core` fails the commit rather than reaching a surface.
Install the hooks once per clone with `pnpm install && pnpm exec lefthook
install`; the same two gates run again in CI. `make sync-core` is deliberately
*not* automated — vendoring is a decision to record in the commit, not a side
effect of it.

`make smoke` needs `mcp/node_modules`, which the root `pnpm install` provides.
It tests the transport and tool registrations, which the core suite does not
cover.

## The package manager

pnpm, pinned by `packageManager` in the root `package.json`. Two properties
matter here and both are load-bearing:

- **One install, two package trees.** `pnpm-workspace.yaml` lists `mcp` as a
  member, so a single `pnpm install` at the root covers the root
  devDependencies *and* `mcp/`'s runtime deps. There is no cross-package
  dependency to model — `mcp/` gets the core by byte-identical file copy, never
  as a package — so the workspace is install orchestration and nothing more.
  `skill/` is deliberately not a member: it has no `package.json` and must keep
  running from a bare checkout with no install step.
- **No phantom dependencies.** pnpm's isolated `node_modules` means a module can
  only import what its own `package.json` declares. The rule that the core ships
  zero runtime dependencies, and that `mcp/` carries nothing beyond the MCP SDK
  and `zod`, is therefore enforced by resolution rather than by discipline — an
  accidental import that npm's flat hoisting would have silently satisfied fails
  outright. Do not add `node-linker=hoisted` or otherwise flatten the store.

pnpm blocks dependency lifecycle scripts by default and **fails the install
until every one is answered** in `pnpm-workspace.yaml` under `allowBuilds`.
Only `lefthook` is allowed one, for the postinstall that links its platform
binary. If a new dependency demands a build script, decide deliberately — do not
reflexively allow it.

Publishing stays on npm (`npm publish` from `mcp/`); see `docs/releasing.md`.

## The correctness rule

**Nothing may resolve a support verdict except `resolveSupport`, and nothing may
read a bundled dataset as the primary source.**

- **Data source.** The dataset comes from
  `https://www.caniemail.com/api/data.json`, fetched at runtime and cached.
  `core/data/caniemail.json` is a committed snapshot serving two jobs: the
  offline fallback, and the deterministic dataset the tests run against. It is
  never the primary. `meta.source` always names which copy answered. Refresh it
  with `make refresh-data`, which will move golden files — that is the signal,
  not a problem. A weekly workflow (`.github/workflows/refresh-data.yml`) runs
  that refresh and opens a PR when upstream has moved, so the snapshot cannot
  decay unnoticed in either of its roles; it opens nothing when the refetch is
  identical.
- **Resolution.** `resolveSupport` owns every verdict. Detection deals in
  feature *titles* and positions and never asks about a client; resolution deals
  in clients and never parses markup. Keeping those apart is structural now
  rather than a discipline, and it is what closed the detection floor.

### Why the resolver is ours (history worth keeping)

This started as a wrapper over the `caniemail` npm package. The package is gone
from the runtime, but the reasoning that removed its resolver still constrains
what `resolveSupport` may do, so it stays documented:

1. `getSupportType` merges `u` (untested) into `'partial'` alongside `a`
   (mitigated). 900 of its 1,637 partial verdicts are actually untested.
2. It sorts version keys lexicographically, but the upstream JSON is already in
   chronological order. **Never sort version keys — take the last one as
   authored.** `outlook.macos` is `["2011", "2016", "16.80"]`; every sort picks
   the wrong one. 280 cells are affected.

   "As authored" rests on one assumption worth knowing: `Object.keys` hoists
   integer-like keys to the front in ascending numeric order, so `"2011"` and
   `"2016"` are ordered by value, not by how they were written. 611 cells have
   two or more such keys and all are already ascending, which makes the hoisting
   a no-op — and it stays one as long as upstream authors year-style keys
   chronologically. If that ever breaks, the fix is to read key order from the
   raw JSON text, not to reintroduce a sort.
3. It throws `RangeError` when a (feature, client) pair has no stats entry, and
   16% have none. Missing data is `untested`, never an exception and never
   `unsupported`. (Reported upstream as shellscape/caniemail#8, open and
   unanswered since 2026-06-05.)

Each has a regression test in `core/caniemail-core.test.mjs`, written against
*our* behaviour so it survives an upstream fix. If a change makes one of those
tests fail, the change is wrong, not the test.

The related invariant: the four verdicts (`supported`, `unsupported`,
`mitigated`, `untested`) must survive into every output. Do not collapse them
into a boolean or a three-state severity anywhere, and do not let `untested`
carry notes — it has no findings to report.

## Detection

`detect.mjs` turns markup into feature titles in **one parse**, with no email
client involved. The load-bearing idea is that "what does this markup use?" is a
question about the markup alone. Do not reintroduce a client into detection —
that coupling is what previously forced 48 parses per document and made 22
features permanently invisible.

The pieces:

- `html-scan.mjs` is a **flat tokenizer, not a DOM.** Detection examines each
  element in isolation — tag name, attributes, `style`, image URLs — and never
  asks about ancestors, siblings or descendants. There is no tree to build.
  Do not add one.
- `css-scan.mjs` **descends into at-rule blocks.** Responsive email lives inside
  `@media`; a scanner that walks only the top level cannot see it.
- Everything is **offsets**, converted to line/column once at the end in
  `detect.mjs`. CSS inside a `<style>` block is put into document coordinates by
  adding the block's start offset. Do not reintroduce line/column arithmetic —
  it is what produced wrong line numbers for every `<style>` finding before.
- `detectFeatures` returns `positions` (rendered `"line:col-line:col"` by
  `formatPosition`, which the goldens also use) and an `occurrence_count`, per
  title. **The count is uncapped and the list is not** — it stops at ten, so a
  generated email cannot inflate the payload, and a disagreement between the two
  is how a caller knows there are more. The first position is always the
  earliest, which is what lets `differential.test.mjs` keep comparing against
  upstream's single position. A title seen in both the `html` and `css` inputs
  reports only the CSS sightings: they are separate coordinate spaces and
  interleaving them would produce line numbers pointing into neither.
- Both scanners are **tolerant and never throw.** This is not defensive coding.
  Email markup is routinely unclosed, unquoted and truncated, and one malformed
  `style` attribute used to void the entire lint.
- Titles are matched from `feature-titles.mjs`, which derives its tables from
  dataset titles **by convention** (`title.endsWith(' unit')`, `/<(\w+)>/`, and
  so on) rather than freezing a list, so a feature added upstream is picked up
  without a release here. The cost is that a novel title *shape* goes unnoticed;
  the coverage test in `core/feature-titles.test.mjs` is the tripwire, asserting
  that exactly four of the 307 features are unreachable (`BIMI`, `Base 64 image
  format`, `HDR image format`, `Video as Image Assets` — none expressible in
  markup). If that count moves, a convention has gone stale.

Cost is ~1ms for a realistic email, against ~59ms for the loop it replaced.

### The differential suite

`core/differential.test.mjs` checks every fixture in `core/fixtures/emails/`
against the `caniemail` package, which stays a **devDependency** for exactly
this purpose — it is the only independent implementation of what was ported.
`core/upstream-detect.mjs` is the only file allowed to import it.

The suite asserts we find everything upstream finds, that positions agree or
diverge for a *verified* reason (it reimplements upstream's `adjustPosition` to
check the `<style>` offset claim arithmetically rather than excusing it), and
that our output matches the golden files in `core/fixtures/expected/`.

Two titles are deliberately *not* reproduced, both listed with reasons in
`EXPECTED_MISSING`: upstream substring-matches tag names, so `<article>` reports
the `<rt>` feature; and it counts class tokens across combinators, so
`.card > .title` reads as chained. Add to that list only when upstream is
demonstrably wrong, never to paper over lost coverage.

When you change a scanner, run `make goldens` and **read the diff**. That diff
is the review artifact.

## Conventions

- Node 22+. The core has **no runtime dependencies**. Do not add one — the
  no-install property of `skill/` depends on it, and `mcp/` should carry nothing
  beyond the MCP SDK and `zod`. pnpm's isolated `node_modules` enforces this for
  `mcp/`; `skill/` has no `node_modules` to be isolated from, so a test in
  `core/skill-cli.test.mjs` asserts every vendored module imports only `node:`
  builtins and relative paths.
- **Both surfaces are executed by tests, not just the core.** `mcp/smoke.mjs`
  (`make smoke`) drives the MCP server over real stdio; `core/skill-cli.test.mjs`
  spawns the skill CLI. Each has its own argument handling that the core suite
  cannot reach. `core/skill-cli.test.mjs` lives in `core/` deliberately — it is
  not in `CORE_FILES`, so it is never vendored, and `skill/` stays at exactly the
  nine published files.
- Tests use `node:test`, run offline against `core/data/caniemail.json`, and
  stay deterministic. Network tests are gated behind `CANIEMAIL_TEST_NETWORK=1`
  and excluded from the default target. "Offline" means **no external
  dependency**, not no sockets: the rule exists so a caniemail.com outage cannot
  read as a broken commit, and `core/dataset-cache.test.mjs` runs a loopback
  `node:http` server on `127.0.0.1` without breaking it. That is deliberate.
  `loadDataset`'s fetch-and-cache ladder is where `meta.source` and
  `meta.warning` come from, every path through it is a failure path, and a
  stubbed `fetch` would have replaced the code under test with the test's own
  idea of it — the loopback server keeps the real `fetch`, the real
  `AbortController` timeout, real status handling and real JSON parsing, and
  stages a 500, a garbage body or a hang in one line each. The `dataUrl` option
  that makes it possible is a real option (a mirror, a proxy), not a test hook.
- One dataset snapshot is committed, at `core/data/caniemail.json`, and vendored
  with the core. It is the offline fallback and the test fixture, never the
  primary source. (This replaces an earlier "no dataset is committed" rule,
  which existed only because the npm package supplied the fallback for free.)
- Every tool result carries `data_source` so a stale answer is visibly stale.
  That obliges a long-lived process to **revalidate rather than load once**: the
  MCP server holds a dataset for 15 minutes at a time, because a server that
  loads at startup and never refetches reports `source: "live"` for as long as
  the editor stays open. Its startup reads only the bundled snapshot, so the
  handshake never waits on the network.
- Tool output is **compact JSON, and sized for a context window**. Both surfaces
  drop indentation when nothing human is reading (the CLI keeps it at a TTY);
  repeated constants become one legend on the result, and client lists compress
  against the set that was checked. Indentation alone was 28% of a lint.

  `lint_email` carries two legends, and the second one names the rule: a
  finding holds only what its **verdict** decides, and anything constant across
  a feature's two or three verdict findings is stated once in `features`, keyed
  by slug (`guidance` is the same trick keyed by verdict). Worth 10–18% of a
  lint depending on the email. The test to keep passing is not the size — it is
  that the legend and the findings name exactly the same features, in both
  directions. The one deliberate exception is `feature_notes`, whose content is
  feature-level but which is suppressed for `untested`: in the legend it would
  be visible from an untested finding again, which is what suppressing it is
  for.
- Author metadata is `shbernal`.

## Scope

Rendering only. Deliverability, SPF/DKIM/DMARC/BIMI, list management, and ESP
selection are explicitly out of scope — if asked to add them, say so rather than
stretching caniemail data to cover questions it cannot answer.
