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
cd .claude/skills/email-compat && npm install
```

Add `-g` for `~/.claude/skills/` instead of the current project.

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

Set `CANIEMAIL_OFFLINE=1` to skip the network and use the bundled dataset.

## Why this is not a thin wrapper

The obvious build is a thin shim over the [`caniemail`](https://github.com/shellscape/caniemail)
npm package, which parses HTML/CSS and reports compatibility issues. Its parsing
and feature detection are good and this project uses them. Its *support
resolution* is not, in three separate ways, and each one breaks precisely the
part of the dataset an agent needs most:

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

So this project uses the package as a parser and resolves every verdict itself,
against the raw dataset, with the four verdicts intact and no re-sorting. The
core suite has a regression test for each defect.

It also fetches live data from caniemail.com rather than relying on the copy
bundled in the package, which tracks an irregular release cadence — eight months
between two recent releases — and was 68 days behind the site at time of
writing. The bundled copy remains the offline fallback, and every result names
which copy answered.

## Verify

```bash
npm install
make test           # core suite, no network
make test-network   # adds the live-fetch test
make smoke          # drives the MCP server over real stdio JSON-RPC
```

## Scope

Rendering only — whether markup displays correctly in a given client. Nothing
about deliverability, SPF/DKIM/DMARC/BIMI, list management, or choosing between
ESPs. Those are different problems and caniemail is not the tool for them.

## License

MIT.

The caniemail dataset is a separate work — MIT, © 2019 Rémi Parmentier — and is
fetched from caniemail.com at runtime rather than redistributed here. The
`caniemail` npm package this depends on is MIT, © Andrew Powell.
