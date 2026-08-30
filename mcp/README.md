# mcp-server-caniemail

MCP server giving an AI agent email client HTML/CSS compatibility data, backed
by [caniemail.com](https://www.caniemail.com).

Email clients are not browsers. Outlook on Windows renders with Microsoft Word,
support for anything modern is patchy, and the difference between "works with a
workaround" and "nobody has ever tested this" decides whether an email ships
broken.

## Install

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

Node 22+. Set `CANIEMAIL_OFFLINE=1` to skip the network and use the bundled
dataset.

## Tools

- `lint_email` takes drafted HTML and/or CSS plus a client list, and returns
  only what breaks, with every source position the feature was used at, affected
  clients, documented workarounds, and a feature URL. Passing features are never
  returned.
- `check_feature_support` gives per-client verdicts for one feature, for
  deciding how to build something rather than checking what you built.
- `search_features` finds feature slugs by keyword. Slugs are not guessable:
  "rounded corners" is `css-border-radius`, flexbox is `css-display-flex`.
- `list_email_clients` is the roster of 48 clients with display names. It is
  inlined into the other tools' descriptions, so this is rarely needed.

## Four verdicts, not a boolean

| Verdict | Severity | Meaning |
|---|---|---|
| `supported` | none | Use it. |
| `unsupported` | `error` | Will not render. Use a fallback. |
| `mitigated` | `warning` | Works with a documented workaround. The note is the answer. |
| `untested` | `unknown` | No data. **Not** evidence of support, or against it. |

Around a sixth of the matrix is untested. Results also carry `last_test_date`
and a staleness note, because some entries have not been retested in five years.

Data is fetched from caniemail.com and cached for 24 hours; every result names
which copy answered via `data_source`. The server revalidates as it runs rather
than loading once at startup, so a session left open for days does not keep
answering from the copy it fetched on the first morning. Startup itself touches
no network, so the handshake never waits on caniemail.com.

`lint_email` is sized for an agent's context. A finding carries only what its
verdict decides, meaning the severity, the clients affected and the notes.
Everything that does not vary by verdict is stated once in a `features` legend
keyed by slug: the title, the URL, the last test date, and `positions`, which
lists every place the markup uses the feature as `"line:col-line:col"` strings
with an `occurrence_count`. `clients_affected` is compressed against the clients
you asked for, so `"*"` or `"outlook.*"`, with `client_count` always exact. The
per-severity advice is a second legend, `guidance`, rather than a paragraph
repeated on every finding.

## Scope

Rendering only. Nothing about deliverability, SPF/DKIM/DMARC/BIMI, list
management, or choosing between ESPs.

## License

MIT. The caniemail dataset is a separate work, MIT, © 2019 Rémi Parmentier,
fetched at runtime rather than redistributed here.

Source: https://github.com/shbernal/caniemail-ai-tooling
