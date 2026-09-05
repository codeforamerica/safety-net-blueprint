# Contributing

## Adding a Changeset

Every PR that changes something worth releasing should include a changeset. Run the interactive CLI from the repo root:

```bash
npm run changeset
```

Use `npm run changeset` rather than `npx changeset` directly — the wrapper prints authoring guidance before opening the CLI.

It will ask which packages changed and whether it's a major, minor, or patch bump, then prompt for a description. The description becomes the CHANGELOG entry — write it for the person reading the changelog, not the person who wrote the code.

**Write descriptions as complete sentences from the consumer's perspective.** Ask yourself: what does this change mean for someone using the package?

| Instead of... | Write... |
|---|---|
| `Fix bug in overlay resolver` | `Overlay resolution now handles circular $ref chains without throwing.` |
| `Add --domain flag to scaffold-api` | `blueprint-scaffold-api now accepts --domain to set the x-domain field in the generated spec.` |
| `Update state machine validator` | `State machine validator now reports the field name when a set: step references a field that doesn't exist on the schema.` |

If the change fixes a GitHub issue, include the issue number at the end of the description: `Overlay resolution now handles circular $ref chains without throwing. (#123)`

**Flagging breaking changes:** All packages are at `0.x`, where minor versions may include breaking changes. If your change breaks consumers (removes a field, renames a CLI flag, changes a function signature), choose `minor` for the bump and start the description with `**Breaking:**` so it stands out in the CHANGELOG:

```
**Breaking:** `blueprint-scaffold-api` no longer accepts `--template` — use `--domain` instead. (#456)
```

Not every PR needs a changeset — skip it for documentation changes, CI fixes, test-only changes, and anything that doesn't affect published package behavior. The changesets bot will comment on PRs missing a changeset; you can dismiss the comment if the PR doesn't warrant one.

**Testing changeset version bumping locally:** To preview how your changeset will affect versions and CHANGELOGs without publishing, run:

```bash
npm run changeset:version
```

This bumps the relevant `package.json` versions and writes the CHANGELOG entries locally. Revert with `git checkout` when done — this is only for verification, not something to commit.

## Release Process

Releases happen automatically when changesets land on `main`. You don't manually run `npm publish`.

**How it works:**

1. PRs merge to `main` with `.changeset/*.md` files included.
2. The Release GitHub Action detects pending changesets and opens (or updates) a "Release: version packages" PR that bumps versions and updates CHANGELOGs.
3. When that PR is merged, the action runs `changeset publish`, which publishes only the packages with new versions to npm and creates git tags (`blueprint-core-v0.2.0`, etc.). The individual `.changeset/*.md` files are deleted as part of the Version PR — their content has been written into the CHANGELOGs.

**What gets published:**

Only packages with a changeset are published in a given release — not all packages publish every time. The publishable packages are:

- `@codeforamerica/blueprint-core`
- `@codeforamerica/blueprint-cli`
- `@codeforamerica/blueprint-mock-server`
- `@codeforamerica/blueprint-safety-net-contracts`

`blueprint-explorer` and `safety-net-explorer` are private and never published.

**Versioning groups:**

`safety-net-contracts` and `safety-net-explorer` are version-locked — if either has a changeset, both get bumped to the same version and published together. You never need to add a changeset for both; one is enough. Framework packages (`blueprint-core`, `blueprint-cli`, `blueprint-mock-server`) version independently.

**Prerequisites for publishing (one-time setup):**

The `NPM_TOKEN` secret must be set in the repository's GitHub Actions secrets. See the [npm access tokens docs](https://docs.npmjs.com/creating-and-viewing-access-tokens) for how to create one. This is a one-time setup — once set, releases are fully automated.
