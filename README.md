# caniemail-ai-tooling

Two ways to give an AI agent working access to email client compatibility data:
a **skill** and an **MCP server**. They share one core and behave identically.

Email clients are not browsers. Outlook on Windows renders with Microsoft Word,
support for anything modern is patchy, and the difference between "works with a
workaround" and "nobody has ever tested this" decides whether an email ships
broken. [caniemail.com](https://www.caniemail.com) has the data. This makes it
usable by an agent.

| Your client | Use | Why |
|---|---|---|
| **Anything whose agent runs commands on your machine** — Claude Code, Codex CLI, OpenClaw, Cursor, Zed | the **skill** | It carries the authoring rules as well as the tools, so the agent writes compatible markup in the first place instead of only checking it afterwards. |
| **Claude Desktop** | the **MCP server over stdio** | A Desktop chat has no local shell, but Desktop does spawn MCP servers on your machine. |
| **claude.ai on the web, or anything running in the cloud** | the **MCP server over HTTP**, hosted by you | A cloud session cannot reach a process on your machine. |

There is no public instance of this server, and nobody is running one for you.

## What it does

Three tools, deliberately not one. A single "give me the caniemail data" tool
would return 620KB of JSON — 307 features across 48 clients — and exhaust an
agent's context before it did anything useful.

- **`lint_email`** — the workhorse. Give it your drafted HTML/CSS and a client
  list; it returns only what breaks, with source positions, affected clients,
  documented workarounds, and a link to each feature. Call it before sending.
- **`check_feature_support`** — for deciding *how* to build something. One
  feature, per-client verdicts, roughly 200 tokens instead of the whole file.
- **`search_features`** — find slugs by keyword. Agents don't know that flexbox
  is `css-display-flex` or that "rounded corners" is `css-border-radius`.

Plus `list_email_clients`, though the roster is inlined into the other tools'
descriptions so it's rarely needed.

## Four verdicts, not a boolean

The dataset distinguishes four states, and collapsing them produces confidently
wrong advice:

| Verdict | Meaning |
|---|---|
| `supported` | Use it. |
| `unsupported` | Will not render. Use a fallback. |
| `mitigated` | Works with a documented workaround — the note is the actual answer. |
| `untested` | No data. **Not** evidence of support, and not evidence against it. |

Around a sixth of the matrix is untested. Every result also carries
`last_test_date` and a staleness note, because some entries have not been
retested in five years.

## Install the skill

```bash
npx skills add shbernal/caniemail-ai-tooling
```

Add `-g` for `~/.claude/skills/` instead of the current project. There is no
install step — the skill has no dependencies, and Node 22+ is the whole
requirement.

Or point your agent at the CLI directly:

```bash
node skill/scripts/caniemail.mjs search "dark mode"
node skill/scripts/caniemail.mjs check css-display-flex --clients 'outlook.*'
node skill/scripts/caniemail.mjs lint --html draft.html --clients '*'
```

## Install the MCP server

```json
{
  "mcpServers": {
    "caniemail": {
      "command": "npx",
      "args": ["-y", "mcp-server-caniemail"]
    }
  }
}
```

Its only dependencies are the MCP SDK and `zod`.

Set `CANIEMAIL_OFFLINE=1` to skip the network and use the bundled snapshot.

## Why this is not a thin wrapper

The obvious build is a shim over the [`caniemail`](https://github.com/shellscape/caniemail)
npm package, which parses HTML/CSS and reports compatibility issues. This
started as exactly that, and stopped being one for two separate reasons.

### The support resolution is wrong

Three defects, each breaking precisely the part of the dataset an agent needs
most:

1. **`untested` is reported as partial support.** `getSupportType` returns
   `'partial'` for anything that is not `y` or `n`, merging `a` (works with a
   workaround) into `u` (never tested). 900 of its 1,637 `partial` verdicts are
   actually untested — 55%, across 76 features — and they surface as warnings
   with no note, which reads as "minor, proceed".

2. **Version selection sorts keys that were already in order.** The upstream
   JSON preserves the chronological order the site displays; the package
   re-sorts it lexicographically and takes the last. `outlook.macos` carries
   `["2011", "2016", "16.80"]`, where the newest entry sorts smallest — both
   lexicographically and numerically. 280 cells resolve to the wrong version,
   flipping verdicts in both directions.

3. **Missing data throws instead of answering.** 16% of (feature, client) pairs
   have no stats entry, and the package raises `RangeError` rather than treating
   them as untested. On realistic markup 14 of 48 clients crash, and the
   documented `['*']` glob fails unconditionally.

So every verdict is resolved here, against the raw dataset, with the four
verdicts intact and no re-sorting. The core suite has a regression test for each.

### The detection was worth owning too

For a while this project kept the package purely as a parser, taking `title` and
`position` from it and discarding every verdict it computed. That worked, and
cost 28 MB of transitive dependencies, an `npm install` in the skill directory,
and a 48-pass parse of every document — because the package reports a feature
only when some probed client fails to fully support it, so detection had to be
run once per client and unioned.

Feature detection is now ours: one parse, no dependencies, and no email client
involved in answering "what does this markup use?". It is both faster and
considerably more complete. Detecting titles directly finds what the old
approach structurally could not:

| Previously undetectable | Why |
|---|---|
| 22 universal features — `<div>`, `<table>`, `px unit`, `PNG` | Every client with data rates them `y`, so no probe ever reported them, and the 6–7 clients with *no* data never got their `untested` verdict |
| Every CSS function — `calc()`, `min()`, `max()`, `var()`, gradients, `rgb()` | The package's function table is iterated with its key and value transposed, so it matches nothing |
| Anything inside `@media` or `@supports` | Only a stylesheet's top level was walked, and responsive email lives in media queries |
| `HTML5 doctype`, `HTML5 semantics`, `Grouping selectors`, `<h2>`–`<h6>`, `<ol>`, `<dl>` | Dead or partial entries in the title tables |
| `display: none !important` | `!important` was compared as part of the value |

Two further defects were fixes rather than additions. Findings inside a
`<style>` block were reported at their offset *within the block* rather than in
the document, so every one carried a wrong line number. And a single malformed
`style` attribute threw out of `style-to-object` with no `try`/`catch` above it,
killing all 48 client passes and returning a clean bill of health for the entire
email.

The package remains a devDependency: it is the only independent implementation
of what was ported, so the differential suite in `core/differential.test.mjs`
checks every fixture against it. Across the corpus it finds 267 feature titles
and we find 125 more, losing only two — both cases where its own detection is
wrong.

### Data freshness

The dataset is fetched live from caniemail.com rather than read from a bundled
copy, because the package's copy tracks an irregular release cadence — eight
months between two recent releases — and was 68 days behind the site at time of
writing. A snapshot in `core/data/caniemail.json` is the offline fallback, so a
skill copied onto a machine with no network still answers, and every result
names which copy answered.

## Verify

```bash
npm install         # devDependencies only; the shipped core has none
make test           # core suite, no network
make test-network   # adds the live-fetch test
make smoke          # drives the MCP server over real stdio JSON-RPC
make check-vendor   # the vendored copies match the core, byte for byte
```

## Scope

Rendering only — whether markup displays correctly in a given client. Nothing
about deliverability, SPF/DKIM/DMARC/BIMI, list management, or choosing between
ESPs. Those are different problems and caniemail is not the tool for them.

## License

MIT.

The caniemail dataset is a separate work — MIT, © 2019 Rémi Parmentier. It is
fetched from caniemail.com at runtime, and a snapshot is committed at
`core/data/caniemail.json` as the offline fallback. The `caniemail` npm package,
used here only as a development-time reference implementation, is MIT,
© Andrew Powell.
