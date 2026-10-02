# Contributing

## Adding a Changeset

Every PR that changes something worth releasing should include a changeset. Run the interactive CLI from the repo root:

```bash
npm run changeset
```

Use `npm run changeset` rather than `npx changeset` directly — the wrapper prints authoring guidance before opening the CLI.

It will ask which packages changed and whether it's a major, minor, or patch bump, then prompt for a description. The description becomes the CHANGELOG entry — write it for the person reading the changelog, not the person who wrote the code.

**Start by naming what a consumer would see.** A different return value, a flag that now works, an error they used to get, a dependency that is no longer installed. If you cannot name one, there is no changeset to write — which is the same test as the skip list further down, applied before you start rather than after. Two ways this goes wrong:

- **Internals dressed as news.** "Walks the contract directory once rather than twice" and "no longer uses `$RefParser` to load specs" describe the diff, not the consumer. Underneath that particular change was something real — a contract set with a bad `$ref` used to stop the server from starting and now starts unvalidated — and that is the entry.
- **Claims nobody checked.** "`cors` and `multer` are no longer installed" is worth saying, and is only worth saying if `package.json` agrees. Verify before you write it.

**Write descriptions as complete sentences from the consumer's perspective.** Ask yourself: what does this change mean for someone using the package?

| Instead of... | Write... |
|---|---|
| `Fix bug in overlay resolver` | `Overlay resolution now handles circular $ref chains without throwing.` |
| `Add --domain flag to scaffold-api` | `blueprint-scaffold-api now accepts --domain to set the x-domain field in the generated spec.` |
| `Update state machine validator` | `State machine validator now reports the field name when a set: step references a field that doesn't exist on the schema.` |

**Reach for before/after first.** Say what someone had to do before, then what they can do now — or, for a fix, what would have happened before and what happens now. It is the most relatable shape, and it forces the consumer's point of view, because the "before" has to be something they could actually have done:

| Shape | Example |
|---|---|
| A new capability | `Before, booting the mock server meant pointing it at a contracts directory. Now blueprint-bundle-contracts writes the set to one JSON file that blueprint-mock --spec=contracts.json can boot from.` |
| A fix | `Before, a metric counting anything other than tasks or events got a 500 from the metrics endpoint. Now the collections come from the metric definitions.` |
| A breaking change | `Where you called generate(docs, 'examples'), call extract(docs, 'examples'). The output is unchanged.` |

**Keep it to one or two sentences, and cut anything that is not actionable.** Two habits to avoid:

- **No "rather than X" clauses.** In *"a name no document belongs to is an error listing the domains the set does have, rather than an artifact that is quietly almost empty"*, the second half argues for the first. Delete it.
- **No measurements.** Sizes, document counts and timings belong in the README or the PR, where someone is deciding whether to care.

The rationale — why two functions are separate, what moved where, incidental fixes found along the way — goes in the commit message, which can be as long as it needs to be.

**Judge the entry against `main`, not against your branch.** A changelog reader has never seen your intermediate steps. If one changeset documents an option on a feature that another *unreleased* changeset introduces, fold it into that one: `--domain` is not news on its own when the command it belongs to is also new.

**Name the file `<package-prefix>-<topic>.md`** — `core-`, `cli-`, `mock-server-`, `contracts-` — matching the first package it declares, so `.changeset/` stays readable at a glance.

If the change fixes a GitHub issue, include the issue number at the end of the description: `Overlay resolution now handles circular $ref chains without throwing. (#123)`

**Flagging breaking changes:** All packages are at `0.x`, where minor versions may include breaking changes. If your change breaks consumers (removes a field, renames a CLI flag, changes a function signature), choose `minor` for the bump and start the description with `**Breaking:**` so it stands out in the CHANGELOG:

```
**Breaking:** `blueprint-scaffold-api` no longer accepts `--template` — use `--domain` instead. (#456)
```

**Flagging deprecations:** If your change is backward-compatible now but something will be removed or renamed in a future version, choose `patch` for the bump and start the description with `**Deprecated:**`. Include what consumers should migrate to so they can plan ahead:

```
**Deprecated:** The `policies-schema.yaml` registry format (`policies:` map) is superseded by `registry-schema.yaml` (`type: policies`, `entries:` map). Both formats are supported. The old format will be removed in a future minor version. (#789)
```

Not every PR needs a changeset — skip it for documentation changes, CI fixes, test-only changes, new packages, and anything that doesn't affect published package behavior. The changesets bot will comment on PRs missing a changeset; you can dismiss the comment if the PR doesn't warrant one.

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
- `@codeforamerica/blueprint-rules-engine`
- `@codeforamerica/blueprint-explorer`
- `@codeforamerica/blueprint-safety-net-contracts`

`safety-net-explorer` is private and never published.

**Versioning groups:**

`safety-net-contracts` and `safety-net-explorer` are version-locked — if either has a changeset, both get bumped to the same version and published together. You never need to add a changeset for both; one is enough. Framework packages (`blueprint-core`, `blueprint-cli`, `blueprint-mock-server`) version independently.

**Prerequisites for publishing (one-time setup):**

The `NPM_TOKEN` secret must be set in the repository's GitHub Actions secrets. See the [npm access tokens docs](https://docs.npmjs.com/creating-and-viewing-access-tokens) for how to create one. This is a one-time setup — once set, releases are fully automated.
