# @codeforamerica/blueprint-core

> Blueprint framework core — contract resolution and validation

[![npm version](https://img.shields.io/npm/v/@codeforamerica/blueprint-core.svg)](https://www.npmjs.com/package/@codeforamerica/blueprint-core)
[![license](https://img.shields.io/npm/l/@codeforamerica/blueprint-core.svg)](https://github.com/codeforamerica/safety-net-blueprint/blob/main/LICENSE)

> **Pre-release:** This package is at `0.x`. Until `1.0.0`, minor versions may include breaking changes. Pin your version if stability matters.

## What It Does

`blueprint-core` is the domain-agnostic runtime library underlying the Blueprint toolkit. It provides the core primitives used by `blueprint-cli` and `blueprint-mock-server`. Most consumers will use those packages rather than importing `blueprint-core` directly.

### Resolution

| Feature | Description |
|---------|-------------|
| **Overlay application** | Applies overlay actions to base specs — adding, updating, or removing fields |
| **RPC endpoint generation** | Adds RPC action paths to OpenAPI specs derived from state machine action definitions |
| **Composition endpoints** | Adds endpoints whose responses are composed from fields across multiple resource schemas |
| **Cross-domain relationships** | Expands foreign key fields into linked or embedded related resources on response schemas |
| **Environment filtering** | Removes contract elements not tagged for the target deployment environment |
| **Placeholder substitution** | Replaces `${VAR}` strings in contracts with values from an env file |

### Validation

| Feature | Description |
|---------|-------------|
| **OpenAPI** | Structural correctness and `$ref` resolution |
| **Design patterns** | List response shapes, pagination parameters, and foreign key annotation requirements |
| **State machines** | Within-file consistency and cross-artifact correctness — referenced fields, enum values, and endpoints |
| **Examples** | Example data accuracy against component schemas |

## Changelog

See [CHANGELOG.md](https://github.com/codeforamerica/safety-net-blueprint/blob/main/packages/blueprint-core/CHANGELOG.md) for release history.

## Documentation

See the [Safety Net Blueprint documentation](https://github.com/codeforamerica/safety-net-blueprint) for full guides and reference.

## License

[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/)
