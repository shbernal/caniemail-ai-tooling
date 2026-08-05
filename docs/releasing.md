# Releasing

Two surfaces ship from this repo on separate channels, and neither is built
from the other:

| Surface | Channel | Artifact |
|---|---|---|
| `skill/` | [ClawHub](https://clawhub.ai) | the skill `email-compat` |
| `mcp/` | [npm](https://www.npmjs.com/) | the package `mcp-server-caniemail` |

Both carry their own vendored copy of the core, so **a release is only correct
if `make check-vendor` passed on the exact commit being released.** That is the
whole reason the pre-commit hook, CI, and `publish.yml`'s `verify` job all run
it.

`.github/workflows/publish.yml` does the uploading. Two triggers, one per
channel:

| Trigger | Publishes |
|---|---|
| pushing a `v*` tag | `mcp-server-caniemail` to npm |
| publishing a GitHub release | `email-compat` to ClawHub |

The split exists because the skill listing's changelog points at the release
page, which does not exist yet when the tag lands. Both halves are idempotent —
re-running at an already-published version skips rather than fails — so a
release that half-failed can simply be run again.

## Before the tag

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
commit. The version the MCP server reports over the wire is read from
`mcp/package.json`, so there is no third place to remember — and the workflow
refuses to publish a tag that disagrees with either manifest.

## Cutting it

```bash
VERSION=$(node -p "require('./mcp/package.json').version")

git push origin main
git tag -a "v$VERSION" -m "v$VERSION" && git push origin "v$VERSION"   # -> npm
gh release create "v$VERSION" --notes-from-tag                         # -> ClawHub
```

Write the tag annotation as the release notes you want, since `--notes-from-tag`
is what puts them on the release page and the ClawHub listing links back to it.

The ClawHub half is skipped when `skill/` is byte-identical to the previous
tag: the two artifacts are independent, and a release that only touched the
server adapter should not mint a skill version with nothing new in it.

Then confirm the published artifacts actually run, rather than assuming a green
workflow implies it:

```bash
npx -y mcp-server-caniemail   # should start and wait on stdio
clawhub inspect email-compat --files   # should list the 9 files
```

Note that `npm view` lags a publish by a minute or two — a version that just
went up still reads as the previous one. Check the release page or the registry
JSON directly rather than concluding the upload failed.

## Authentication

- **npm** uses [trusted publishing][tp] (OIDC): the package is configured on
  npmjs.com to trust this repository's `publish.yml`, so the workflow needs
  `id-token: write` and no token at all. npm attaches build provenance as a side
  effect. The job upgrades npm before publishing because OIDC needs `>= 11.5.1`,
  which is newer than any Node line currently bundles.
- **ClawHub** has no OIDC path, so it authenticates with a long-lived
  `CLAWHUB_TOKEN`. It is an *environment* secret on `release`, which is why the
  skill job declares `environment: release` and the npm job does not — a job
  outside the environment reads that secret as an empty string, and a job inside
  it carries an `environment` claim that npm's trusted publisher, configured
  without one, has no reason to accept.

[tp]: https://docs.npmjs.com/trusted-publishers

## Publishing by hand

Still worth knowing, both as a fallback and because the traps are not obvious.
Each half is what the workflow runs.

The skill path must be **absolute** — ClawHub rejects a relative one with the
unhelpful `Error: Path must be a folder`. Dry-run first; it prints the file
count and a fingerprint without publishing anything.

```bash
clawhub skill publish "$PWD/skill" \
  --slug email-compat --name "Email Compatibility" \
  --version "$VERSION" --dry-run
```

`fileCount` should be **9**: `SKILL.md`, the CLI, the six vendored core modules,
and the dataset snapshot. Anything else means `skill/` picked up a stray file.

Drop `--dry-run` to publish, and pass the source references so the listing links
back to the commit it was built from, plus `--changelog` — left out, ClawHub
invents its own summary, and 0.2.0 published describing a change from the
release before it:

```bash
clawhub skill publish "$PWD/skill" \
  --slug email-compat --name "Email Compatibility" --version "$VERSION" \
  --source-repo shbernal/caniemail-ai-tooling \
  --source-commit "$(git rev-parse HEAD)" \
  --source-ref main --source-path skill \
  --changelog "https://github.com/shbernal/caniemail-ai-tooling/releases/tag/v$VERSION"
```

The slug is `email-compat`, matching the `name:` in `SKILL.md`. ClawHub
otherwise defaults it to the folder name, which would publish it as `skill`.

The npm half publishes from within `mcp/`. Its `files` field limits the tarball
to `src` and `README.md`, and `src/data/caniemail.json` rides along inside `src`
— verify that, because a tarball without the snapshot has no offline fallback:

```bash
cd mcp
npm pack --dry-run          # expect src/data/caniemail.json in the listing
npm publish                 # add --otp=<code> if 2FA is enabled
```

`mcp/LICENSE` is a copy of the repo-root one, not a symlink. npm only picks up a
LICENSE from the *package* root, so without the copy the tarball declared MIT and
shipped no licence text. It is MIT boilerplate and does not drift; if the root
one is ever edited, copy it across.

The name is unscoped, so it is public by default; no `--access public` needed.
npm sets the executable bit on the `bin` entry at install time, which is why
`src/server.mjs` being committed executable matters only to git clones.

Publishing stays on **npm** even though development uses pnpm. Nothing here
needs pnpm's help: the tarball is just the `files` list, and `mcp/` has no
`workspace:` dependencies for a publish step to rewrite — it reaches the core by
file copy. Keeping the publish command the same as the one consumers see
(`npx -y mcp-server-caniemail`) is worth more than tool consistency.

## Notes

- The version numbers are not required to move together. The skill and the
  package are independent artifacts on independent channels; the workflow's
  `skill/` diff check is what keeps a release from minting an identical skill
  version.
- A published version is permanent on both registries. Never delete or
  re-publish one; fix forward with a bump on whichever surfaces are affected.
