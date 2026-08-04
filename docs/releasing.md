# Releasing

Two surfaces ship from this repo on separate channels, and neither is built
from the other:

| Surface | Channel | Artifact |
|---|---|---|
| `skill/` | [ClawHub](https://clawhub.ai) | the skill `email-compat` |
| `mcp/` | [npm](https://www.npmjs.com/) | the package `mcp-server-caniemail` |

Both carry their own vendored copy of the core, so **a release is only correct
if `make check-vendor` passed on the exact commit being released.** That is the
whole reason the pre-commit hook and CI both run it.

## Before either channel

```bash
pnpm install && pnpm exec lefthook install   # once per clone
make sync-core                               # if the core changed at all
make test check-vendor smoke                 # one install already covered mcp/
make test-network                            # confirms the live fetch still works
```

Then decide whether the dataset snapshot should move. It is the offline
fallback both surfaces ship with, so a release is a natural point to refresh it:

```bash
make refresh-data && make sync-core && make goldens
```

`make goldens` will move fixtures whenever the upstream data changed. **Read
that diff** — it is the review artifact, not noise to commit past.

Finally, bump the version in `package.json` and `mcp/package.json`, move the
`## Unreleased` heading in `CHANGELOG.md` to the new version with a date, and
commit.

## The skill, to ClawHub

The path must be **absolute** — ClawHub rejects a relative one with the
unhelpful `Error: Path must be a folder`. Dry-run first; it prints the file
count and a fingerprint without publishing anything.

```bash
clawhub publish "$PWD/skill" \
  --slug email-compat --name "Email Compatibility" \
  --version 0.1.0 --dry-run
```

`fileCount` should be **9**: `SKILL.md`, the CLI, the six vendored core modules,
and the dataset snapshot. Anything else means `skill/` picked up a stray file.

Drop `--dry-run` to publish, and pass the source references so the listing links
back to the commit it was built from:

```bash
clawhub publish "$PWD/skill" \
  --slug email-compat --name "Email Compatibility" --version 0.1.0 \
  --source-repo shbernal/caniemail-ai-tooling \
  --source-commit "$(git rev-parse HEAD)" \
  --source-ref main --source-path skill
```

The slug is `email-compat`, matching the `name:` in `SKILL.md`. ClawHub
otherwise defaults it to the folder name, which would publish it as `skill`.

## The MCP server, to npm

Publish from within `mcp/`. Its `files` field limits the tarball to `src` and
`README.md`, and `src/data/caniemail.json` rides along inside `src` — verify
that, because a tarball without the snapshot has no offline fallback:

```bash
cd mcp
npm pack --dry-run          # expect src/data/caniemail.json in the listing
npm publish                 # add --otp=<code> if 2FA is enabled
```

The name is unscoped, so it is public by default; no `--access public` needed.
npm sets the executable bit on the `bin` entry at install time, which is why
`src/server.mjs` being committed executable matters only to git clones.

Publishing stays on **npm** even though development uses pnpm. Nothing here
needs pnpm's help: the tarball is just the `files` list, and `mcp/` has no
`workspace:` dependencies for a publish step to rewrite — it reaches the core by
file copy. Keeping the publish command the same as the one consumers see
(`npx -y mcp-server-caniemail`) is worth more than tool consistency.

## After

```bash
git tag -a v0.1.0 -m "v0.1.0" && git push origin v0.1.0
gh release create v0.1.0 --notes-from-tag
```

Then confirm the published artifacts actually run, rather than assuming the
upload implies it:

```bash
npx -y mcp-server-caniemail   # should start and wait on stdio
clawhub inspect email-compat  # should list the 9 files
```

## Notes

- The version numbers are not required to move together. The skill and the
  package are independent artifacts on independent channels; couple them only
  when a core change actually affects both.
- There is no automated publish. Both channels are deliberately manual — the
  release ritual is where the vendoring guarantee gets a human check, and a
  push-triggered publish would remove exactly that.
