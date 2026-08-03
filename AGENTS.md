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

**Never delegate a support verdict to the `caniemail` package.** It is used for
one thing — parsing HTML/CSS and detecting which features appear — and its own
resolution is wrong in three ways that this core exists to correct:

1. `getSupportType` merges `u` (untested) into `'partial'` alongside `a`
   (mitigated). 900 of its 1,637 partial verdicts are actually untested.
2. It sorts version keys lexicographically, but the upstream JSON is already in
   chronological order. **Never sort version keys — take the last one as
   authored.** `outlook.macos` is `["2011", "2016", "16.80"]`; every sort picks
   the wrong one. 280 cells are affected.
3. It throws `RangeError` when a (feature, client) pair has no stats entry, and
   16% have none. Missing data is `untested`, never an exception and never
   `unsupported`.

Each has a regression test in `core/caniemail-core.test.mjs`, written against
*our* behaviour so it survives an upstream fix. If a change makes one of those
tests fail, the change is wrong, not the test.

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
call that throws.

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
