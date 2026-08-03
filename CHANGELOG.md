# Changelog

## Unreleased

Initial implementation. Nothing published yet.

- Shared core (`core/caniemail-core.mjs`) resolving caniemail support data with
  all four verdicts intact: `supported`, `unsupported`, `mitigated`, `untested`.
- Skill surface: `SKILL.md` with HTML email authoring rules, plus a CLI
  (`search`, `check`, `lint`, `clients`).
- MCP surface: `mcp-server-caniemail`, exposing `lint_email`,
  `check_feature_support`, `search_features`, and `list_email_clients`.
- Live dataset fetch with a 24-hour cache and the npm package's bundled copy as
  the offline fallback. Every result names which copy answered.

Corrects three defects in the upstream `caniemail` package, each with a
regression test:

- `untested` no longer collapses into `mitigated` (900 of 1,637 upstream
  `partial` verdicts are actually untested).
- Version keys are read in authored order rather than sorted (280 cells resolve
  to the wrong version under a lexicographic sort).
- Missing stats entries resolve to `untested` instead of raising `RangeError`
  (16% of pairs have no entry; 14 of 48 clients crash on realistic markup).
