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

## Pre-release

This project has no release yet. Treat it as free to change:

- Do not preserve backwards compatibility unless Santiago explicitly asks.
- Do not defer to the prior architecture when it conflicts with the current goal.
- Existing code, docs, and plans are context, not constraints.

Once there is a release, compatibility becomes a real constraint and this
section gets replaced with the rules in `rfc-ai-tooling/AGENTS.md`.

## The vendoring rule

`core/caniemail-core.mjs` is the single implementation.
`skill/scripts/caniemail-core.mjs` and `mcp/src/caniemail-core.mjs` are
byte-identical vendored copies, not independent code.

- **Never edit a vendored copy directly.** Edit the core, then `make sync-core`.
- `make check-vendor` fails the build on drift.

The core is plain ESM with JSDoc types rather than TypeScript, specifically so
the vendored copies need no build step on either surface. Keep it that way — a
compile step would have to run in both places and the vendoring guarantee would
stop being a byte comparison.

## Commands

```bash
npm install         # root, for the core suite
make test           # core suite, no network
make test-network   # adds the live-fetch test
make sync-core      # copy the core into both surfaces — run after any core edit
make check-vendor   # verify the vendored copies match
make smoke          # drive the MCP server over real stdio JSON-RPC
```

Run `make sync-core test check-vendor` before committing any core change.

`make smoke` needs `mcp/node_modules`, so run `npm install` in `mcp/` first. It
tests the transport and tool registrations, which the core suite does not cover.

## The correctness rule

**The `caniemail` package is a parser. It is never a data source, and never a
resolver.** Both halves of that are load-bearing:

- **Not a data source.** The dataset comes from
  `https://www.caniemail.com/api/data.json`, fetched at runtime and cached. The
  copy bundled in the package is the offline fallback only, and `meta.source`
  always names which copy answered. Do not read `caniemail.json` as the primary.
- **Not a resolver.** `resolveSupport` owns every verdict. Nothing reaching an
  output may come from `getSupportType`, `getAllFeatures`, or the `support`
  field on a package issue — only `issue.title` and `issue.position`.

What we take from it is the one thing it does well: turning HTML and CSS into
feature titles with `{line, column}` positions. That is ~760 lines of mapping
over `htmlparser2`, `@adobe/css-tools` and `css-what`, covering CSS properties,
property/value pairs, functions, keywords, units, at-rules and selector shapes;
HTML elements, attributes and element+attribute pairs; and image formats read
out of `src`, `srcset` and `url()`. It reaches all but three of the 307
features, and the tables derive from feature titles by convention rather than
being a static list, so they do not rot against upstream. Reimplementing that is
not worth it; delegating a verdict to it is never worth it.

The resolver half of the rule is not stylistic. The package's resolution is
wrong in three ways this core exists to correct:

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

Only (3) actually taxes us, and only because `checkFeatures` resolves support
just to decide whether to record an issue — which is what drags a broken
resolver into an otherwise clean parse. (1) and (2) never touch our output.

The related invariant: the four verdicts (`supported`, `unsupported`,
`mitigated`, `untested`) must survive into every output. Do not collapse them
into a boolean or a three-state severity anywhere, and do not let `untested`
carry notes — it has no findings to report.

## Detection

`detectFeatures` runs `caniemail()` once per client inside a try/catch and
unions the results. Both halves are load-bearing:

- Running one client would miss every feature *that* client fully supports,
  because `caniemail()` only reports non-full support.
- The try/catch is not defensive coding. 14 of 48 clients throw on realistic
  markup, and the crash is per *feature*, not per client, so no static allowlist
  can prevent it.

Do not "optimise" this into a single call with all clients — that is exactly the
call that throws. Nor into a small "cover set" of the nine clients whose stats
are complete: `outlook.windows` + `gmail.android` + `yahoo.desktop-webmail`
reaches only 269 of 307 features, and the 38 it misses are exactly the ones
below. The full loop costs ~28ms warm. Leave it alone.

### The detection floor

Because the package only records an issue when *some* probed client resolves to
non-full, a feature that every client with stats rates `y` can never be
detected. 22 of 307 features are in that state, and every one of them also has
6–7 clients with no stats at all — which `resolveSupport` correctly calls
`untested`:

```
<div> <p> <span> <table> <strong> <del> <h1>-<h6> valign vertical-align
px pt em ex cm mm in pc % units    PNG    JPG
```

So `lint_email` does not report those untested verdicts, even with
`includeUntested: true`. This is a known gap, not a design decision — it is the
one place the four-verdict invariant is not fully honoured end to end. In
practice it is the most benign 22 features in the dataset (`<div>` untested on
`laposte.android` is noise), which is why it is documented rather than fixed.
If it ever needs fixing, the fix is a title-independent detection pass, not a
change to the client loop.

## Conventions

- Node 22+. The core's only runtime dependency is the `caniemail` package; do
  not add another.
- Tests use `node:test`, run offline against the dataset bundled in that
  package, and stay deterministic. Network tests are gated behind
  `CANIEMAIL_TEST_NETWORK=1` and excluded from the default target.
- No dataset is committed to this repo. It is fetched at runtime and cached, and
  the npm package's bundled copy is the offline fallback.
- Every tool result carries `data_source` so a stale answer is visibly stale.
- Author metadata is `shbernal`.

## Scope

Rendering only. Deliverability, SPF/DKIM/DMARC/BIMI, list management, and ESP
selection are explicitly out of scope — if asked to add them, say so rather than
stretching caniemail data to cover questions it cannot answer.
