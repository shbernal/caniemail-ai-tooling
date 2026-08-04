# Changelog

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
