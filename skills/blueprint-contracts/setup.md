# Setting up the project

Set up the folder described in [step-build.md](step-build.md), in the developer's project directory. Ask before writing into a directory that already has files.

## Node

The blueprint packages require Node 22.11.0 or later. Run `node -v` first. If it's older, or Node isn't installed, stop and tell the developer to install Node 22 (for example with `nvm install 22`) before going on: on an older version, the tools fail with errors that don't say why.

## Packages

Pin the versions in [versions.json](versions.json) exactly, so the reference docs match what's installed:

```bash
npm init -y
npm pkg set type=module
npm install --save-exact @codeforamerica/blueprint-core@{version} @codeforamerica/blueprint-cli@{version} @codeforamerica/blueprint-mock-server@{version} @codeforamerica/blueprint-rules-engine@{version}
```

If the project already has blueprint packages at other versions, stop and tell the developer: the docs in this skill may not match them.

## The regenerate command

One command runs the blueprint's own tools in order. Every tool takes `--flag=value`.

```bash
npm pkg set scripts.regenerate="rm -rf generated && blueprint-resolve --spec=./contracts --overlay=./contracts/overlays --out=./generated/resolved && blueprint-validate --resolved=./generated/resolved && mkdir -p generated/bundled && blueprint-bundle-contracts --spec=./generated/resolved --out=./generated/bundled/contracts.json && blueprint-build-explorer --spec=./generated/resolved --out=./generated/explorer --config=./explorer"
```

Don't use `blueprint-scaffold-api`: its output needs several fixes ([known-traps.md](known-traps.md)). Write each API file from [creating-apis.md](reference/docs/guides/creating-apis.md).

## Roles

Every kind of person in the scope's "Who uses it" table is a role the contracts name in `actors:`. The framework knows only `readonly`, `readwrite`, `admin` and `system`, so add the others with an overlay, `contracts/overlays/roles.yaml`:

```yaml
overlay: 1.0.0
info:
  title: {Project} roles
  version: 0.1.0
actions:
  - target: $.$defs.RoleType.enum
    description: The people who act in this system (scope.md, "Who uses it").
    append:
      - {role}
```

Name roles in snake_case, as [naming.yaml](reference/docs/conventions/naming.yaml) says.

## The explorer's settings

The explorer won't build without two settings files. Write them from the scope:

`explorer/config.yaml`:

```yaml
name: "{Project name}"
domains:
  - id: {domain id}
    label: {Domain name}
    status: partial
    description: {one line, from the scope's "Owns"}
    entities: [{Record}, {Record}]
```

`explorer/context-map/config/config.yaml`:

```yaml
title: "{Project name}: context map"
subtitle: "How the domains connect"
```

## Check it

Run `npm run regenerate` once the first contract file exists, and fix what it reports before writing more.
