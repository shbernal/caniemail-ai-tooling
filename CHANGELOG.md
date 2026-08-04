# Changelog

## Unreleased

- Dependency updates are automated. Dependabot watches npm weekly from the
  workspace root — which is the only correct entry for a pnpm workspace, since
  Dependabot resolves every member from the directory holding the lockfile and
  rejects a second entry pointing inside it — plus the GitHub Actions pins in
  CI, which nothing else ever looks at. Minor and patch bumps group into one PR
  per ecosystem; majors stay separate, because an MCP SDK major is a surface
  change to review rather than a bump to merge.

- `lint_email` costs about half what it did. A realistic newsletter against all
  48 clients went from 75KB to 41KB — roughly 19k tokens to 10k — with nothing
  removed from the result. Both surfaces now emit compact JSON (the CLI still
  indents at a TTY), which alone was 28% of the payload; the per-severity
  `guidance` paragraph moved from every finding to one legend on the result;
  `clients_affected` is compressed against the clients actually checked, so `*`
  and `outlook.*` stand in for the expansion while `client_count` stays exact;
  and positions are `"line:col-line:col"` strings rather than nested objects.

  `include_untested` deliberately still defaults to true. Untested findings are
  half the payload, but "untested is not evidence of support" is the single most
  load-bearing claim this tool makes, and defaulting it off would have quietly
  undone that to save bytes. Likewise `url` stays on every finding even though it
  is derivable from the slug: an agent citing a source should not have to
  reassemble the link.

- Lint findings report **every** occurrence of a feature, not just the first.
  `positions` lists up to ten and `occurrence_count` is the true total, so an
  email using `border-radius` twelve times no longer reads as using it once.
  Previously an agent that fixed the reported position had no signal the rest
  existed.

- The MCP server revalidates its dataset as it runs, every 15 minutes, instead of
  loading once at startup. A server lives as long as the editor session, so the
  old behaviour kept reporting `data_source.source: "live"` with no warning and a
  `fetchedAt` from days earlier — exactly the silent staleness that field exists
  to prevent. Startup now reads only the bundled snapshot, so the handshake never
  waits on caniemail.com; the first tool call fetches.

- `check_feature_support` pins a version per client instead of failing the call.
  `--version 2016` over `outlook.*` used to throw because a sibling client
  versions itself by date, naming a client the caller never asked about — while
  the documentation advertised that exact query as the common case. Clients with
  no such version now resolve to `untested` with `version_requested` set. A
  version *no* requested client carries is still an error, so a typo is still
  caught.

- The skill CLI is covered by tests (`core/skill-cli.test.mjs`). Both surfaces
  ship, both have argument handling the core suite cannot reach, and only the MCP
  server was ever executed by CI. The same file guards the no-install property by
  asserting the vendored modules import nothing but `node:` builtins and relative
  paths — pnpm enforces that for `mcp/`, but `skill/` has no `node_modules` to be
  isolated from.

- The dataset cache is written atomically. The two surfaces share one cache
  directory, so a concurrent refresh could interleave into a truncated file; the
  corrupt-cache guard turned that into a redundant fetch rather than a failure,
  but a temp-file-and-rename removes it.

- `mcp-server-caniemail` ships its LICENSE. npm only includes a licence from the
  package root, so the published tarball declared MIT and contained no licence
  text. The server also reports its version from `package.json` rather than a
  hardcoded string that would drift at the next release.

- Development now uses pnpm, with `mcp/` as a workspace member so one
  `pnpm install` covers both package trees. Neither shipped artifact changes:
  the core still has zero runtime dependencies, `mcp/` still carries only the
  MCP SDK and `zod`, and `skill/` still runs from a bare checkout with no
  install step. pnpm's isolated `node_modules` turns the zero-dependency rule
  into something resolution enforces rather than something to remember.
  Publishing stays on npm.

## 0.1.0 — 2026-08-04

First release. The skill ships to ClawHub as `email-compat`, the MCP server to
npm as `mcp-server-caniemail`. The two are independent artifacts on independent
channels; `docs/releasing.md` has the process for each.

- Shared core (`core/`) resolving caniemail support data with all four verdicts
  intact: `supported`, `unsupported`, `mitigated`, `untested`. Zero runtime
  dependencies — Node 22+ and nothing else.
- Skill surface: `SKILL.md` with HTML email authoring rules, plus a CLI
  (`search`, `check`, `lint`, `clients`).
- MCP surface: `mcp-server-caniemail`, exposing `lint_email`,
  `check_feature_support`, `search_features`, and `list_email_clients`.
- Live dataset fetch with a 24-hour cache and a committed snapshot
  (`core/data/caniemail.json`) as the offline fallback. Every result names which
  copy answered.
- Feature detection is ours: one parse per document rather than one per email
  client, and no `npm install` on either surface. It closes the gap where 22
  universally-supported features (`<div>`, `<table>`, `px unit`, `PNG`) could
  not be detected at all, along with every CSS function, everything inside
  `@media`, and several dead entries in the title tables. Findings inside a
  `<style>` block now carry correct document line numbers, and a malformed
  `style` attribute no longer voids the entire lint. The `caniemail` package
  remains a devDependency, used by `core/differential.test.mjs` as the
  reference implementation the port is checked against.

Corrects three defects in the upstream `caniemail` package, each with a
regression test:

- `untested` no longer collapses into `mitigated` (900 of 1,637 upstream
  `partial` verdicts are actually untested).
- Version keys are read in authored order rather than sorted (280 cells resolve
  to the wrong version under a lexicographic sort).
- Missing stats entries resolve to `untested` instead of raising `RangeError`
  (16% of pairs have no entry; 14 of 48 clients crash on realistic markup).

Notes are scoped to the verdict they describe. A note attached to one client's
cell no longer travels onto another client's finding, and the feature-level
remark is surfaced separately as `feature_notes` — otherwise `css-gap` reports
as a hard failure in Outlook annotated "Partial. Supports column-gap", which is
Gmail's note.
