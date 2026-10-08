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
| `generate(docs, type, opts?)` | Derive an artifact: `overlay`, `graph`, `postman`, or `artifact` |
| `extract(docs, type, opts?)` | Read out a fact the documents already state: `relationships`, `state-machines`, `sla-types`, `metrics`, `config`, `registries`, `examples` |
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

### A contract set as one file

`generate(docs, 'artifact')` reduces a set to data, and `extract(artifact,
'docs')` reads it back:

```js
import { discover, load, generate, extract } from '@codeforamerica/blueprint-core';

const artifact = generate(discover(dir).map(load), 'artifact');
writeFileSync('contracts.json', JSON.stringify(artifact));

// Elsewhere — in Node, or in a browser:
const docs = extract(JSON.parse(contracts), 'docs');
```

The documents come back with their methods rebuilt, which JSON cannot carry,
so a set read from a file behaves like one walked off disk. An artifact records
each document's place in the set and nothing about the machine that wrote it, so
`path` is the same as `relativePath` on the way back — readers that want a
filename take the last segment either way. `$ref`s are left intact: they name other documents in the same set, so
the set is already complete, and inlining them is the difference between a
0.67 MB file and a 3.95 MB one.

For one domain and what it references, pass `{ domains: ['intake'] }` — the
named domains plus `platform` plus the transitive closure of their refs, so
the result is self-contained.

`blueprint-cli`'s `blueprint-bundle-contracts` is this with validation and a
command line around it.

### In a browser

`extract` and `generate` need no filesystem, and the `./browser` export is
those two alone:

```js
import { extract, generate } from '@codeforamerica/blueprint-core/browser';
```

A separate subpath rather than a condition on `"."`, because this is a smaller
surface and not a second implementation — importing `discover` from it should
fail at the import rather than resolve to `undefined` and break somewhere
unrelated.

Importing them from `"."` does not work in a browser, and the reason is worth
knowing: a bundler resolves every import in a module graph *before* it
tree-shakes, so `index.js` re-exporting `discover` is enough to fail a page
build even when the consumer imports nothing but `extract`. The main entry
re-exports `./browser`, so the two cannot drift.

`discover` and `load` are absent because they read a directory. `resolve` and
`validate` are absent for a different reason: they read resources this package
ships — the schemas to validate against, overlay documents — rather than
anything the caller supplies. Bundling those the way contracts are bundled
would make both portable.

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
| **References** | Every `$ref` and `x-relationship.resource` against the document or schema it names |

Every contract type is either validated or explicitly reported as having no validator, so a type nobody checks surfaces as a gap rather than passing silently.

A reference that names something not in the set is an error, not a warning. A `$ref` to a missing document, or an `x-relationship.resource` naming no schema, used to be either ignored or reported as a warning during resolution — which is how 56 broken refs and five inert relationships survived in this repo's own contracts. Canonical `https://blueprint.codeforamerica.org/...` refs are exempt: they resolve through the schema registry rather than by path.

OpenAPI structural validation and example-data validation live in `blueprint-mock-server`, which is what serves them.

## Changelog

See [CHANGELOG.md](https://github.com/codeforamerica/safety-net-blueprint/blob/main/packages/blueprint-core/CHANGELOG.md) for release history.

## Documentation

See the [Safety Net Blueprint documentation](https://github.com/codeforamerica/safety-net-blueprint) for full guides and reference.

## License

[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/)
