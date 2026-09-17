# @codeforamerica/blueprint-harness

> Shared sample contracts and generated artifacts for testing blueprint tooling packages

This is a private, internal package. It is not published to npm.

## What It Contains

A complete sample blueprint project used as a shared test fixture across all blueprint tooling packages (`blueprint-cli`, `blueprint-explorer`, `blueprint-rules-engine`, etc.).

| Directory | Contents |
|-----------|----------|
| `contracts/` | Source contract files — OpenAPI specs, state machines, rules, annotations, overlays |
| `resolved/` | Resolved contract output (generated from `contracts/`) |
| `clients/` | Generated TypeScript clients (generated from `resolved/`) |
| `explorer/` | Explorer HTML outputs and configuration (generated from `resolved/` and `clients/`) |

## Regenerating Artifacts

Resolved contracts and clients are regenerated from `blueprint-cli`:

```bash
# From packages/blueprint-cli
npm run regen:harness
```

Explorer outputs are regenerated from `blueprint-explorer`:

```bash
# From packages/blueprint-explorer
node build.js \
  --content=../blueprint-harness/explorer \
  --resolved=../blueprint-harness/resolved \
  --clients=../blueprint-harness/clients
```

Regenerate only when a golden test fails and the change is intentional. Review the git diff before committing.

## License

[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/)
