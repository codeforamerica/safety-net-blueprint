# @codeforamerica/blueprint-core

## 0.3.0

### Minor Changes

- fe0c210: Before, `extract` and `generate` only ran in Node, because importing either one pulled the filesystem in with it. Now the new `./browser` export runs them in a page: `generate(docs, 'artifact')` turns a contract set into one serializable object, `extract(artifact, 'docs')` turns it back into documents, and `{ domains: ['intake'] }` narrows it to the domains you name. (#448)
- 57981c8: **Breaking:** `resolve()` no longer returns a `manifest`, and a `Doc` no longer carries `provenance` or `resolved`. Nothing wrote the manifest file those fields were read from, so `resolved` was always `false` and `provenance` always `null`. (#448)
- fe0c210: **Breaking:** where you called `generate(docs, 'examples')`, call `extract(docs, 'examples')`. The output is unchanged. (#448)
- 869d7d5: Before, reading a state machine, SLA type set, metric, config or registry out of a contract set meant locating the documents and merging them yourself, and a cross-file `$ref` was read off disk. Now `extract(docs, type)` reads `'state-machines'`, `'sla-types'`, `'metrics'`, `'config'` and `'registries'` — `extract(docs, 'registries').policies` returns the policies registry, merged across every document that contributes to it — and refs resolve against the documents you passed in. (#448)
- c268256: **Breaking:** before, `validate` silently ignored a `$ref` naming a document outside the set, an `x-relationship.resource` naming no schema, and a state machine declaring `machines` without a `domain`. Now each is an error, so a contract set that passed before may report new ones. (#448)

### Patch Changes

- 62cb9e6: Before, a `${VAR}` placeholder in an overlay's `config:` block was used verbatim — `x-event-type-prefix: ${EVENT_PREFIX}` prefixed every event type with that literal text, silently. Now config values are substituted like the rest of the contract set, so a cross-cutting setting can vary by environment, and `resolve()` reports the names of any placeholders that found no value. (#464)
- fe0c210: Before, a document in `domains/scheduling/` had no domain unless it declared one itself, so `scheduling-openapi.yaml` was in the scheduling domain and `scheduling-mock-data.yaml` was in none. Now the directory name supplies it; `base/` and `common/` stay domainless. (#448)
- fe0c210: Before, `doc.externalRefs(docs)` and `doc.resolveRef` could disagree about the same ref, and `externalRefs` needed a filesystem to answer at all. Now both resolve against the set's relative paths — and a document loaded on its own, with no `relativePath`, no longer finds its siblings. (#448)
- 7164d54: Before, an operation could declare a `sort` query parameter while the server rejected every `?sort=` it advertised, because sorting is gated on a separate `x-sortable` extension and nothing checked the two agreed. Now `validate` warns when a sort parameter is declared without one. (#448)

## 0.2.0

### Minor Changes

- a89ec45: **Breaking:** `blueprint-core` now has one entry point instead of seventeen
  subpaths. Import `discover`, `load`, `generate`, `extract`, `resolve`,
  `validate`, `schemasDir` and `baseContractsDir` from the package root;
  `/openapi`, `/rules`, `/validator`, `/overlay`, `/relationships`,
  `/compositions`, `/state-machines`, `/json-schema`, `/registries` and
  `/annotations` no longer resolve. `load` now takes a `DiscoveredFile`, so
  `discover(dir).map(load)` replaces
  `discover(dir).map((f) => load(f.path, f.relativePath))`. `Doc.refs` and
  `Doc.model` are methods rather than fields, because as fields they went stale
  as soon as a resolve pass rewrote `content`. OpenAPI loading and validation
  moved to `blueprint-mock-server`, annotation merging to `blueprint-explorer`,
  and `bundleSpec` to `blueprint-cli`. (#425)
- 15e4b60: **Deprecated:** The `policies-schema.yaml` registry format (`policies:` map) is
  superseded by `registry-schema.yaml` (`type: policies`, `entries:` map). Named
  registry files (`*-registry-{type}.yaml`) are discovered automatically. Both
  formats are supported; the old one will be removed in a future minor version.
- d1a80d3: **Breaking:** JSON schema validation no longer strips `$schema` before
  validating. A schema with `additionalProperties: false` that does not declare
  `$schema` will now fail; add `$schema: { type: string }` to its properties.

  `blueprint-core` also gains rules contract support: a schema for
  `*-rules.yaml`, a compiler producing portable `*-graph.yaml` dependency
  graphs, a validator with cycle and unreachable-node detection and CEL syntax
  checking, and an endpoint overlay generator. (#425)
- 15e4b60: **Breaking:** Annotation files key fields by spec-relative path
  (`application.members[].dateOfBirth`) rather than schema-relative path
  (`member.dateOfBirth`). The first segment is the camelCase schema name,
  followed by the dot-bracket field path. This matches the data dictionary and
  the field inventory, so one path form works across all three.

## 0.1.1

### Patch Changes

- 6f440c3: `blueprint-resolve` now exits with a clear error if `blueprint-core`'s base contracts are missing, rather than silently producing broken output. The `base-contracts/` and `assets/` directories are now correctly included in the `blueprint-core` npm package, fixing resolution failures for consumers who installed from npm.
