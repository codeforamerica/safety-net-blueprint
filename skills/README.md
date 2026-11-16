# Claude Code skills

Skills for building with the blueprint in [Claude Code](https://docs.claude.com/en/docs/claude-code). A skill is a folder of instructions Claude Code loads when a task calls for it.

| Skill | What it does |
|---|---|
| [blueprint-contracts](blueprint-contracts/SKILL.md) | Works out with a developer what they're building and which contracts it needs, writes that down as `scope.md`, then builds the contracts, scenarios that pass on the mock, and the explorer's pages |

## Build

From the repository root:

```bash
node skills/build.js
```

This writes `skills/dist/blueprint-contracts/` and `skills/dist/blueprint-contracts.zip`. `dist/` isn't committed.

The skill carries the blueprint's docs in its `reference/` folder, copied from git at the release tag named in its `versions.json`, so they match the package versions the skill installs. Your clone needs that tag; run `git fetch --tags` if the build can't find it. A link from a copied doc to one that isn't copied points to GitHub at that release.

To build another skill, or from another tag:

```bash
node skills/build.js {name} --ref={git ref}
```

A skill's `bundle.json` lists which docs it copies.

## Install

Unzip into `~/.claude/skills/`, so the skill sits at `~/.claude/skills/blueprint-contracts/`, then start a new Claude Code session. To test changes, link the built folder instead and rebuild after each change:

```bash
ln -s "$PWD/skills/dist/blueprint-contracts" ~/.claude/skills/blueprint-contracts
```

## Update for a new release

1. Change the versions in `blueprint-contracts/versions.json`.
2. Rebuild.
3. Check each trap in `blueprint-contracts/known-traps.md` against the new packages, and remove the ones that are fixed.
