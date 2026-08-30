# Contributing

Issues and pull requests are welcome, including fully AI-generated ones. There
is no policy here against a patch a model wrote.

## Disclose the AI

If a model helped write an issue or a pull request, say which harness and which
model, for example "Claude Code, Opus 5" or "Codex CLI, GPT-5". This is not a
disclaimer. It tells a reviewer what to check first.

## Setup

```bash
pnpm install                 # devDependencies and mcp/'s deps; the shipped core has none
pnpm exec lefthook install   # once per clone, wires the pre-commit hook
```

`mcp/` is a workspace member, so one install covers both package trees. pnpm is
pinned by `packageManager` in `package.json`, so Corepack fetches the right
version on its own.

pnpm is load-bearing, not a preference. Its isolated `node_modules` means a
module can only import what its own `package.json` declares, so "the core has
zero runtime dependencies" is enforced by resolution rather than by discipline.
Do not set `node-linker=hoisted`. `skill/` stays outside the workspace and needs
no install at all, which is what lets it run from a bare checkout.

## Verify

```bash
make test           # core suite, no network
make test-network   # adds the live-fetch test
make smoke          # drives the MCP server over real stdio JSON-RPC
make check-vendor   # the vendored copies match the core, byte for byte
```

CI runs all of these except `test-network`, on Node 22 and 24. The pre-commit
hook runs `make test` and `make check-vendor`, so a stale vendored copy cannot
be committed.

## Edit the core, never a copy

`core/` is the only implementation. Everything under `skill/scripts/` and
`mcp/src/` is a byte-identical copy of it, listed in the Makefile's `CORE_FILES`.
Edit the core, then sync:

```bash
make sync-core
```

Run `make sync-core test check-vendor` before committing any core change.
Syncing is deliberately not automatic. Vendoring is a decision to record in the
commit rather than a side effect of it.

## Fixtures and the dataset

Changing a scanner moves the golden files. Regenerate them, then read the diff,
because that diff is the review artifact:

```bash
make goldens
```

`make refresh-data` refetches the caniemail.com snapshot at
`core/data/caniemail.json`, which is the offline fallback and the fixture the
tests run against. It also moves goldens. A weekly workflow runs the same
refresh and opens a PR when upstream has changed.

## Releasing

`docs/releasing.md` covers both channels. `AGENTS.md` documents the rules a
change has to respect, and is worth reading before a first patch.
