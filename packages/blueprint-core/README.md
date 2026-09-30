# @codeforamerica/blueprint-core

> Blueprint framework core — contract resolution and validation

[![npm version](https://img.shields.io/npm/v/@codeforamerica/blueprint-core.svg)](https://www.npmjs.com/package/@codeforamerica/blueprint-core)
[![license](https://img.shields.io/npm/l/@codeforamerica/blueprint-core.svg)](https://github.com/codeforamerica/safety-net-blueprint/blob/main/LICENSE)

> **Pre-release:** This package is at `0.x`. Until `1.0.0`, minor versions may include breaking changes. Pin your version if stability matters.

## What It Does

`blueprint-core` is the domain-agnostic runtime library underlying the Blueprint toolkit. It provides the core primitives used by `blueprint-cli` and `blueprint-mock-server`. Most consumers will use those packages rather than importing `blueprint-core` directly.

## Usage

The package has a single entry point. Everything on it describes one stage of the contract pipeline:

```js
import { discover, load, generate, extract, resolve, validate } from '@codeforamerica/blueprint-core';

const docs = discover(contractsDir).map(load);

const resolved = resolve(docs, {
  overlays: [...stateOverlays, ...generate(docs, 'overlay')],
  envTarget: 'production',
  envVariables: { SUPPORT_EMAIL: 'help@example.gov' },
});

const { ok, report } = validate(resolved.docs);
```

| Function | Description |
|----------|-------------|
| `discover(dir, type?)` | Find contract files on disk, each with its type and domain. Optionally filtered to one type |
| `load(file)` | Parse what `discover` returned into a `Doc` |
| `generate(docs, type, opts?)` | Derive an artifact: `overlay`, `graph`, `postman`, or `examples` |
| `extract(docs, type, opts?)` | Read out a fact the documents already state: `relationships` |
| `resolve(docs, opts)` | Apply the resolution passes below |
| `validate(docs)` | Check the set against its schemas and cross-artifact rules |

Also exported: `schemasDir` and `baseContractsDir`, the directories this package ships.

Only `discover` reads the filesystem for input, and only the caller writes output. Everything between operates on documents already in memory.

A `Doc` carries `path`, `relativePath`, `type`, `domain` and the parsed `content`, plus `refs()`, `externalRefs(docs)`, `resolveRef(ref, docs)` and `model()`. Those four are methods, not fields: a resolution pass produces its next document by copying the previous one, so anything computed once at load would describe content that has since been rewritten.

### Resolution

Passes run in order, each taking the whole set and returning it.

| Pass | Description |
|------|-------------|
| **Overlay application** | Applies overlay actions to base specs — adding, updating, or removing fields |
| **Enum injection** | Fills enums declared with `x-enum-source` from the contract that owns the values |
| **Event type prefixing** | Applies a state's `x-event-type-prefix` to emitted and subscribed event types |
| **Cross-domain relationships** | Expands foreign key fields into linked or embedded related resources on response schemas |
| **Environment filtering** | Removes contract elements not tagged for the target deployment environment |
| **Placeholder substitution** | Replaces `${VAR}` strings in contracts with values from an env file |

RPC action paths and composition endpoints are not passes — they are overlays produced by `generate(docs, 'overlay')` and applied like any other.

### Validation

| Feature | Description |
|---------|-------------|
| **JSON Schema** | Every contract against the schema its `$schema` declares |
| **Design patterns** | List response shapes, pagination parameters, and foreign key annotation requirements |
| **State machines** | Within-file consistency and cross-artifact correctness — referenced fields, enum values, and endpoints |
| **Rules** | Ruleset inputs, outputs, and fact dependencies |
| **Events** | Emitted and subscribed event types against the channels declared for them |
| **Annotations** | Annotation keys against the fields they describe |
| **Field references** | SLA type and metric field paths against the schemas they point at |

Every contract type is either validated or explicitly reported as having no validator, so a type nobody checks surfaces as a gap rather than passing silently.

OpenAPI structural validation and example-data validation live in `blueprint-mock-server`, which is what serves them.

## Changelog

See [CHANGELOG.md](https://github.com/codeforamerica/safety-net-blueprint/blob/main/packages/blueprint-core/CHANGELOG.md) for release history.

## Documentation

See the [Safety Net Blueprint documentation](https://github.com/codeforamerica/safety-net-blueprint) for full guides and reference.

## License

[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/)
