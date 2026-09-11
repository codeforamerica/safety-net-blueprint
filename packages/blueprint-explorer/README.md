# @codeforamerica/blueprint-explorer

> Static documentation generator for Blueprint framework projects — contract reference, state machine diagrams, event catalog, and data dictionaries

[![npm version](https://img.shields.io/npm/v/@codeforamerica/blueprint-explorer.svg)](https://www.npmjs.com/package/@codeforamerica/blueprint-explorer)
[![license](https://img.shields.io/npm/l/@codeforamerica/blueprint-explorer.svg)](https://github.com/codeforamerica/safety-net-blueprint/blob/main/LICENSE)

> **Pre-release:** This package is at `0.x`. Until `1.0.0`, minor versions may include breaking changes. Pin your version if stability matters.

## Installation

```bash
npm install --save-dev @codeforamerica/blueprint-explorer
```

## What It Does

Generates a set of static HTML reference tools from resolved Blueprint contract artifacts. Point it at your resolved specs and TypeScript clients to produce a browsable documentation hub that can be published as a GitHub Pages site or any static host.

| Tool | Description |
|------|-------------|
| **API Reference** | Endpoint docs derived from resolved OpenAPI specs — parameters, request/response schemas, status codes, and links to related state machine transitions |
| **Client Reference** | TypeScript SDK reference — types, methods, and usage examples per domain |
| **State Machine Docs** | Full state machine reference — states, transitions, guard conditions, actor restrictions, and event subscriptions per resource |
| **Event Catalog** | Cross-domain event index — every emitted event with its publisher, payload schema, and known subscribers |
| **Data Dictionaries** | Field-level reference derived from writable schemas — field names, types, policy citations, and data classifications |
| **Sequence Diagrams** | Key workflow sequences showing cross-domain interactions |
| **Context Map** | Domain relationship diagram showing cross-domain data dependencies |

## Usage

```bash
# Build all tools
node build.js \
  --content=./packages/safety-net-explorer \
  --resolved=./resolved \
  --clients=./clients

# Build a single tool
node build.js --only=api-reference --resolved=./resolved --clients=./clients
node build.js --only=state-machine-docs --resolved=./resolved
node build.js --only=event-catalog --resolved=./resolved
node build.js --only=data-dictionaries --resolved=./resolved
```

Output is written to the `--content` directory as static HTML files. The API reference, state machine docs, event catalog, and data dictionaries update automatically as contracts change — rebuild after each resolve step.

## Changelog

See [CHANGELOG.md](https://github.com/codeforamerica/safety-net-blueprint/blob/main/packages/blueprint-explorer/CHANGELOG.md) for release history.

## Documentation

See the [Safety Net Blueprint documentation](https://github.com/codeforamerica/safety-net-blueprint) for full guides and reference.

## License

[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/)
