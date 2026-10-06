# Changelog

## Unreleased

- The MCP server moves to v2 of the MCP TypeScript SDK, which replaces the
  single `@modelcontextprotocol/sdk` package with `@modelcontextprotocol/server`
  ^2.3.1. The tools, their schemas and their output are unchanged, and clients
  negotiating older protocol versions are still served. The skill is not
  affected.

- The MCP tools are annotated `readOnlyHint: true` and `openWorldHint: false`.
  None of them changes anything, and all of them answer from one dataset, so a
  client that honours the hints can run them without asking first.

## 0.3.0 - 2026-10-05

- `search_features` on the MCP server no longer rejects a category its schema
  did not know. The schema froze `html`, `css`, `image` and `others`, so a
  category added upstream failed validation before the core, which checks
  against the live data, could accept it. The schema now lists the categories
  in its description, and an unknown one comes back as a tool error naming the
  valid set.

- A CSS hex escape in a selector now takes the whitespace that ends it, as CSS
  defines. `.\31 0` is the class `10`; it was read as `.\3`, `1` and a
  descendant combinator before `0`, so `lint_email` reported a descendant
  combinator the stylesheet does not use.

- A `/*` inside a CSS string or after a backslash is no longer stripped as a
  comment. `content: "/* x */"` read as `""`, and the selector `.a\/*b` lost
  everything from the `/*` on, while the same scan's comment list correctly
  reported no comment in either.

- The supported Node floor moves from 22 to 24, on both surfaces. Node 22 is in
  maintenance and takes security fixes only, so testing against it bought a
  compatibility claim for a line nothing here is developed on. `engines` in both
  manifests now reads `>=24.0.0`, and CI's matrix is the floor plus whatever Node
  is current, which is where a Node release that breaks something shows up.

  Nothing in the code needed a newer runtime; this is the support promise
  changing, not the implementation. On Node 22 the MCP server still runs and npm
  will now warn about it.

- Both scanners are linear in their input again. The CSS scanner searched to
  the end of the document for a `{` once per statement, so a long run of
  statements with nothing after it, which is the tail of every truncated
  stylesheet, cost the square of its length: 25 KB of `;` took six seconds in
  `lint_email`. The HTML scanner lowercased the whole document once per
  `<style>`, `<script>`, `<title>`, `<textarea>` or `<xmp>`, which a template
  with a few hundred conditional style blocks pays for at every one.

  The HTML fix also corrects positions after a character whose lowercase form
  is longer than itself. `İ` lowercases to two code units, so a raw-text closing
  tag found in the lowercased copy was reported one character late for every
  such character before it, and the `<style>` block's CSS was measured from the
  wrong place.

- A client glob made of repeated `*` no longer wedges the process. Each star
  compiled to its own `[^.]*`, and side by side they backtrack exponentially on
  a client they cannot match: twenty stars took seconds per call, and the MCP
  server is single-threaded, so every session on it waited. A run of stars now
  counts as one, which matches exactly the same clients.

- Deeply nested braces no longer make `lint_email` fail. The CSS scanner
  recursed once per `{`, so about 6 KB of unclosed `a{` overflowed the stack and
  the caller got "Maximum call stack size exceeded" as the answer about their
  email. The scanner now stops descending 64 blocks deep and steps over
  anything deeper as one unit, then carries on with the rest of the stylesheet.

- One unterminated string, `url(` or `[` no longer hides the rest of the
  stylesheet. Each ran to the end of the document looking for its closing
  delimiter, so everything after it went unscanned and `lint_email` reported
  `passed: true` for rules it never read. A string now ends at a newline it does
  not escape, as CSS ends one, and an unclosed quote is read as an ordinary
  character. An unclosed parenthesis or bracket ends at the next `{` or `}`.
  A stray `}` at the top level of a stylesheet used to end the scan too, and is
  now stepped over.

  The cost is a `{` or `}` inside an *unquoted* `url()`, which now ends the
  group early. Quoted URLs are unaffected. An unterminated comment still runs
  to the end of the stylesheet, because it does in every client.

- `occurrence_count` is right past ten sightings. A construct that raises one
  feature twice over the same range, such as `background: url(a.png),
  url(b.png)` for PNG, is one sighting, but the duplicate check only looked at
  the ten positions kept for display. From the eleventh sighting on, each such
  duplicate counted again: fifteen of those rules reported twenty.

- `searchFeatures` rejects an unknown category rather than returning nothing,
  naming the categories the dataset has. The MCP schema already ruled one out;
  on the CLI, `--category bogus` was a clean zero-result search.
- The skill CLI's `clients` command carries `data_source`, as every other
  command and the MCP tool already did.
- A CLI flag that takes a value no longer swallows the flag after it.
  `--clients --offline` read as a client named "--offline" and ran against the
  network; it is now the error `--clients needs a value.`

- The MCP server loads the dataset once per revalidation, however many tool
  calls arrive while it is loading. Each call that found the 15-minute window
  expired started its own load, so an agent firing three tools after a quiet
  spell paid for three fetches and kept one. The holder is now
  `revalidatingDataset` in the core. `list_email_clients` also returns a
  failure as a tool error, as the other three tools do, instead of letting it
  escape as a protocol error.

- `DATA_URL` is no longer exported from `caniemail-core.mjs`. Nothing used it
  outside the module. To point `loadDataset` somewhere else, pass `dataUrl`.

- The bundled dataset snapshot is refreshed to upstream's 2026-09-16 update.
  Gmail now reads as mitigated rather than unsupported for `image-svg` (the
  image renders, rasterised to PNG) and, on iOS and Android, for
  `html-meta-color-scheme` (only `light only` is honoured).

- The MCP server depends on `@modelcontextprotocol/sdk` ^1.32.0.

## 0.2.2 - 2026-09-04

- A live fetch now has to return something shaped like the dataset before it is
  believed. `indexDataset` reads `raw.data ?? []`, so a 200 carrying valid JSON
  with no feature records indexed to zero features and was returned as
  `source: "live"` with `warning: null`. An endpoint that had moved and said so
  produced a confident empty matrix: `search_features` reported every feature as
  nonexistent, and `check_feature_support` and `lint_email` failed with
  "No client matches", which reads as the caller's typo.

  The check is structural rather than a count, so it accepts a mirror serving a
  subset and rejects an error page that happens to parse. A body that fails it
  takes the same route as a 500, down to the cache and then the bundle, with the
  warning that says so. It runs before the cache write and on every cache read,
  because the write is what turned one bad response into a day of it for every
  process sharing the directory, and a cache written before this existed is
  still on disk. `make refresh-data` shares the predicate and keeps its own
  `>= 250` floor on top, which asks whether this is the *whole* dataset, the
  right question for the committed snapshot and the wrong one at runtime.

  Nothing changes for a caller getting real data. `isDatasetShaped` is exported
  in case a mirror wants to check its own copy.

- The live-fetch test runs nightly instead of never. It has always been gated
  behind `CANIEMAIL_TEST_NETWORK=1` and excluded from `make test`, so that a
  caniemail.com outage could not read as a broken commit here. What it never had
  was anywhere to run: no job set that variable, and the one code path that
  actually talks to upstream had no automated coverage at all. `ci.yml` now has a
  `network` job on a daily schedule, and only on a schedule, never on a push or a
  pull request. Upstream keeps no veto over whether a commit is green, and a
  failure there means upstream moved rather than this change is broken.

  The loopback server in `core/dataset-cache.test.mjs` does not cover this and is
  not meant to. It exercises the real `fetch` against a stand-in endpoint, which
  proves the fetch-and-cache ladder works and says nothing about whether
  caniemail.com still answers, or still answers with a dataset.

## 0.2.1 - 2026-08-30

- The dataset snapshot both surfaces ship as their offline fallback moves from
  2026-07-20 to 2026-08-10: one feature added (`html-command-attribute`), no
  removals, and thirteen verdict cells changed across `css-inset` and
  `html-popover`. Detection output is identical on every fixture.

- Titles naming several attributes are derived by convention rather than listed.
  `srcset and sizes attributes` was the only one upstream had written, so it sat
  in a hardcoded table; upstream then added `command and commandfor attributes`
  and it was undetectable until someone noticed. Both now come from the same
  rule, as does whatever the next one is called.

  A derived name has to look like an attribute for the title to count. Without
  that, a prose title along the lines of "Deprecated presentational attributes"
  would yield a name no markup can match while still counting as covered, which
  would quietly disable the tripwire in `core/feature-titles.test.mjs` that
  caught this in the first place.

- Releases publish themselves. `.github/workflows/publish.yml` uploads the npm
  package on a `v*` tag push and the skill on a published release, and runs the
  whole suite on the released ref before either. A tag does not match CI's
  `branches: [main]` filter, so until now nothing verified the exact commit that
  reached the registries. It also refuses a tag that disagrees with either
  manifest, which is the failure no amount of care catches. `v0.2.0` tagged over
  an unbumped `mcp/package.json` publishes 0.1.0 under a 0.2.0 release.

  npm authenticates by OIDC trusted publishing, so no token lives in this repo
  and the tarball carries build provenance. ClawHub has no such path and uses a
  `CLAWHUB_TOKEN` secret. Both halves skip an already-published version rather
  than failing, and the skill is skipped entirely when `skill/` has not changed
  since the previous tag.

## 0.2.0 - 2026-08-05

`lint_email` returns a different shape. A finding now carries only what its
verdict decides and the rest sits in two legends on the result, positions are
strings, and `version_requested` has moved off the entries of
`check_feature_support`'s `support` array. Anything reading those fields off a
finding has to follow the legend instead; the details are below. Nothing was
removed from what a result tells you, and the payload is roughly half what it
was.

- A lint finding now carries only what its verdict decides, and everything else
  moves to a `features` legend keyed by slug, the same trick `guidance` already
  used, one level down. A feature that fails differently in different clients
  produces two or three findings, and each was repeating the title, the URL, the
  last test date and the source positions, none of which any verdict changes.
  On the three template fixtures, linted against all 48 clients: 42,177 → 36,057
  bytes (−14.5%), 58,285 → 48,061 (−17.5%), and 18,596 → 16,629 (−10.6%).

  `positions` moving is the part worth knowing about, since it costs an
  indirection to learn where a problem is. It is worth it twice over. It is the
  largest repeated field, and it was never verdict-dependent to begin with.
  Two findings for one feature always pointed at the same places, and sitting on
  the finding they invited the reading that they did not.

  The flat, severity-sorted `findings` list is unchanged. Grouping by feature
  would have collapsed the duplication too, and destroyed the ordering that lets
  an agent fix the most damaging thing first.

  `feature_notes` deliberately stays on the finding despite being feature-level.
  It is suppressed for `untested` verdicts, and in the legend it would be
  reachable from an untested finding again, which is the thing the suppression
  exists to prevent.

- Three small corrections to the core API.

  A client list that is not a list now says so. `{ clients: 'outlook.windows' }`
  was answered with "at least one client or glob is required", which sends you
  looking for a client you had already supplied.

  A `limit` that cannot return anything is an error rather than an empty result,
  matching the stance already taken on an unmatched glob. `--limit 0` reported
  "5 matches" beside an empty list, and `--limit abc` reached the core as `NaN`
  and read as "no such feature", a typo answered with a confident nothing. The
  MCP schema already rejected both; the CLI is where they were reachable.

  `version_requested` is gone from the individual entries of the `support`
  array `check_feature_support` returns, and stays on the result. It was on
  the clients the pin missed and absent on the ones it landed on, so one array
  held two shapes; `versions_on_record` already explains why a pin did not land.

- The MCP server keeps its feature array across a revalidation that finds
  upstream unmoved, so the memoised title tables survive with it, while still
  adopting the fresh `meta`. `data_source` has to keep telling the truth about
  `source` and `fetchedAt`, which is the thing the 15-minute revalidation exists
  to get right. Measured at about 1ms per revalidation and no more, since the
  parse and the index still happen. It is here because unmoved data being the
  same dataset is worth saying, not for the microseconds.

- The dataset cache is covered by tests. It was the least-tested code in the
  repo and it is what implements the promise that a stale answer is visibly
  stale: `meta.source` and `meta.warning` are computed nowhere else, every path
  that produces them is a failure path, and none of them ran in CI. Twelve cases
  now drive `loadDataset` against a loopback HTTP server, covering the freshness
  boundary, a cache truncated by a concurrent write, an error status whose body
  parses, a server that accepts the connection and says nothing, and a cache
  directory that cannot be written. Each was checked by breaking the behaviour
  it guards and confirming it failed. Coverage of the core went from 91.6% to
  99.7% of lines.

  `loadDataset` takes a `dataUrl` option, which is what makes that possible.
  It is a real option rather than a test hook, pointing at a mirror or a proxy
  for anyone who cannot reach caniemail.com directly.

- The dataset snapshot can no longer decay unnoticed. A weekly workflow
  refetches it, and opens a pull request only when upstream has moved. A no-op
  PR every Monday would just teach the reviewer to ignore the ones that matter.
  The body is the review artifact: `last_update_date` before and after,
  the feature count, added and removed slugs, and every support cell that
  flipped, because most refreshes change verdicts rather than the feature list.
  The suite runs before and after `make goldens` so a detection-output move
  reads differently from a real break. Refreshing has always been able to move
  golden files; that was fine while it was a deliberate command and a silent
  liability once it stopped being run, since the snapshot is both the offline
  fallback and the fixture every test runs against.

- Dependency updates are automated. Dependabot watches npm weekly from the
  workspace root, the only correct entry for a pnpm workspace, since Dependabot
  resolves every member from the directory holding the lockfile and rejects a
  second entry pointing inside it. It also watches the GitHub Actions pins in
  CI, which nothing else ever looks at. Minor and patch bumps group into one PR
  per ecosystem; majors stay separate, because an MCP SDK major is a surface
  change to review rather than a bump to merge.

- `lint_email` costs about half what it did. A realistic newsletter against all
  48 clients went from 75KB to 41KB, roughly 19k tokens down to 10k, with
  nothing removed from the result. Both surfaces now emit compact JSON (the CLI still
  indents at a TTY), which alone was 28% of the payload; the per-severity
  `guidance` paragraph moved from every finding to one legend on the result;
  `clients_affected` is compressed against the clients actually checked, so `*`
  and `outlook.*` stand in for the expansion while `client_count` stays exact;
  and positions are `"line:col-line:col"` strings rather than nested objects.

  `include_untested` deliberately still defaults to true. Untested findings are
  half the payload, but "untested is not evidence of support" is the single most
  load-bearing claim this tool makes, and defaulting it off would have quietly
  undone that to save bytes. Likewise `url` stays on every finding even though it
  is derivable from the slug, because an agent citing a source should not have to
  reassemble the link.

- Lint findings report **every** occurrence of a feature, not just the first.
  `positions` lists up to ten and `occurrence_count` is the true total, so an
  email using `border-radius` twelve times no longer reads as using it once.
  Previously an agent that fixed the reported position had no signal the rest
  existed.

- The MCP server revalidates its dataset as it runs, every 15 minutes, instead of
  loading once at startup. A server lives as long as the editor session, so the
  old behaviour kept reporting `data_source.source: "live"` with no warning and a
  `fetchedAt` from days earlier, exactly the silent staleness that field exists
  to prevent. Startup now reads only the bundled snapshot, so the handshake never
  waits on caniemail.com; the first tool call fetches.

- `check_feature_support` pins a version per client instead of failing the call.
  `--version 2016` over `outlook.*` used to throw because a sibling client
  versions itself by date, naming a client the caller never asked about, while
  the documentation advertised that exact query as the common case. Clients with
  no such version now resolve to `untested` with `version_requested` set. A
  version *no* requested client carries is still an error, so a typo is still
  caught.

- The skill CLI is covered by tests (`core/skill-cli.test.mjs`). Both surfaces
  ship, both have argument handling the core suite cannot reach, and only the MCP
  server was ever executed by CI. The same file guards the no-install property by
  asserting the vendored modules import nothing but `node:` builtins and relative
  paths. pnpm enforces that for `mcp/`, but `skill/` has no `node_modules` to be
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

## 0.1.0 - 2026-08-04

First release. The skill ships to ClawHub as `email-compat`, the MCP server to
npm as `mcp-server-caniemail`. The two are independent artifacts on independent
channels; `docs/releasing.md` has the process for each.

- Shared core (`core/`) resolving caniemail support data with all four verdicts
  intact: `supported`, `unsupported`, `mitigated`, `untested`. Zero runtime
  dependencies, Node 22+ and nothing else.
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
remark is surfaced separately as `feature_notes`. Otherwise `css-gap` reports
as a hard failure in Outlook annotated "Partial. Supports column-gap", which is
Gmail's note.
