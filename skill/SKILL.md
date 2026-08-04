---
name: email-compat
description: >
  Write and verify HTML email that renders correctly across email clients. Use whenever
  building, editing, or reviewing an HTML email, an email template, or a transactional
  message — and whenever a question involves Outlook, Gmail, Apple Mail, or "will this
  render in email". Covers what CSS and HTML each client actually supports, backed by
  caniemail.com data. Provides the layout rules that keep an email compatible in the
  first place, then lints the finished markup and reports only what breaks, per client,
  with workarounds. Not for sending mail, deliverability, SPF/DKIM/DMARC, or ESP choice.
---

# HTML email compatibility

Email clients are not browsers. Outlook on Windows renders with Microsoft Word,
Gmail strips `<style>` blocks in some contexts, and support for anything modern
is patchy and undocumented. This skill covers both halves of the problem: write
markup that survives, then verify it against real data.

`scripts/caniemail.mjs` queries the caniemail.com dataset. Node 22+ and nothing
else — no dependencies, no install step. It works offline against a bundled
dataset snapshot, and says so when it does.

```bash
node scripts/caniemail.mjs <command> [options]
```

Everything it prints is JSON.

## The loop

Write using the rules below, then **always lint before calling it done**. The
rules prevent the common failures; the linter catches the rest.

```bash
# 1. Find the slug — they are not guessable.
node scripts/caniemail.mjs search "rounded corners"
#    -> css-border-radius

# 2. Decide how to build it.
node scripts/caniemail.mjs check css-border-radius --clients outlook.windows,gmail.*

# 3. Lint the finished email.
node scripts/caniemail.mjs lint --html draft.html --clients '*'
```

## Reading a verdict

Four verdicts, and collapsing them is how confidently wrong advice happens.

| Verdict | Severity | What to do |
|---|---|---|
| `supported` | — | Use it. |
| `unsupported` | `error` | It will not render. Use a fallback. |
| `mitigated` | `warning` | Works **with a documented workaround**. Read `notes` — this is where the useful detail lives. |
| `untested` | `unknown` | Nobody has tested it. **This is not evidence of support, and not evidence against it.** Avoid it, or test it yourself. |

`untested` is the one that matters most. It is not a soft `unsupported` and not
a soft `supported`; roughly a sixth of the whole matrix has no data at all.
Never report an untested feature as working.

Also check `last_test_date` and `staleness`. Some entries have not been retested
in five years, and the tool tells you when a verdict is old enough to distrust.

## Commands

```bash
search <query> [--category html|css|image|others] [--limit N]
check  <slug> --clients <globs> [--version <v>]
lint   --clients <globs> [--html FILE] [--css FILE] [--no-untested]
clients
```

`--clients` takes comma-separated `family.platform` globs. Wildcards work on
either segment: `outlook.windows`, `outlook.*`, `*.ios`, or `*` for all 48.

`lint` reads stdin as HTML when given neither `--html` nor `--css`, so
`cat draft.html | node scripts/caniemail.mjs lint --clients '*'` works.

`check --version` pins a specific client version instead of the newest —
`--version 2016` answers "does this work in Outlook 2016", which is usually the
real question.

### Clients worth knowing

These are different rendering engines, not variants of one product:

- **`outlook.windows`** — the Word renderer. The strictest target by far. No
  flexbox, no grid, no `border-radius`, no background images without VML,
  unreliable `padding` on `<div>` and `<p>`.
- **`outlook.outlook-com`** — Outlook.com webmail. A normal browser engine.
  Almost nothing in common with the above despite the name.
- **`outlook.macos`** — versions `2011`, `2016`, then `16.80` (the rewritten
  "new Outlook"), which behaves entirely differently from the older ones.
- **`gmail.desktop-webmail`** vs **`gmail.mobile-webmail`** — different support,
  particularly around media queries and embedded styles.

## Writing email that survives

Follow these by default and most lint findings never appear.

**Layout**

- Use `<table>` for layout. Not `<div>` + flexbox, not grid — `display:flex` and
  `display:grid` are unsupported in Outlook Windows and several others.
- Set `role="presentation"` on layout tables so screen readers skip them.
- Fixed width, 600px or narrower. Use nested tables rather than `float` or
  `position` — neither is reliable.
- Spacing goes on `<td>` via `padding`, or on spacer rows. Margins are
  inconsistent, and `padding` on `<div>`/`<p>` is unreliable in Outlook.

**CSS**

- Inline every style that matters. `<style>` blocks are stripped or ignored in
  several clients, notably Gmail in forwarded and clipped messages.
- Keep a `<style>` block only for what cannot be inlined — media queries and
  pseudo-classes — and treat it as progressive enhancement.
- No shorthand you can avoid: `background-color` beats `background`.
- Avoid `position`, `float`, `z-index`, `calc()`, custom properties, and web
  fonts as anything other than an enhancement with a real fallback.

**Content**

- Always set `alt` on images; many clients block images by default, so the alt
  text *is* the email for those readers.
- Set explicit `width` and `height` on images, and `display:block` to kill the
  gap under them.
- Never rely on an image alone to carry meaning or a call to action.
- Include a plain-text alternative part.

**Dark mode**

- `prefers-color-scheme` is supported in some clients and ignored in others,
  and some clients invert colours on their own regardless.
- Do not use pure `#FFFFFF` or `#000000` where inversion would destroy contrast.
- Test transparent PNGs against both backgrounds.

**Outlook Windows specifically**

- Rounded corners and background images need VML. The linter's `notes` field
  gives the specific technique per feature.
- Wrap Outlook-only markup in `<!--[if mso]> ... <![endif]-->` conditional
  comments; other clients ignore them.

## Scope

This covers **rendering only** — whether markup displays correctly. It says
nothing about deliverability, SPF/DKIM/DMARC/BIMI, list management, or choosing
between ESPs. Those are different problems with different tools.

## Data freshness

The dataset is fetched from caniemail.com and cached for 24 hours. Every result
carries a `data_source` field naming which copy answered — `live`, `cache`, or
`bundled` — with a warning when it is not the live one. Pass `--offline` to skip
the network deliberately, or `--refresh` to force a fetch.
