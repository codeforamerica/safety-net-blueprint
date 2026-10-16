# @codeforamerica/blueprint-core

## 0.4.0

### Minor Changes

- 3d96fc4: A contract set can now include Arazzo scenarios — files ending `.arazzo.yaml`, declaring their domain in `info.x-domain` — which resolve carries with the other contracts and `validate` checks: each step must call an operation the set has, generated ones included, and refer only to earlier steps. (#470)
- 685f4ea: Before, a state machine's transitions were documented under its first machine's item path in the API its `apiSpec` named. Now each attaches to the resource it names, in whichever OpenAPI document of its domain declares it, so intake's Verification transitions appear under the verification. (#470)
- f6e9cd2: A context binding's `where` can now be a CEL string, true for the record to bind, with the candidate record as `item` beside `object` and `request`. (#470)
- 3335c89: **Breaking:** Before, a composition with no `endpoint:` was silently never served. Now every composition must declare `endpoint: {path}`, a well-formed path with no trailing slash, and validation refuses a route that two rulesets, compositions, actions or operations claim, naming both. (#470)
- 2da51d3: **Breaking:** Where a config catalog was `queues: [...]`, write `queues: { resource: Queue, entries: [...] }`. Validation now fails when a seeded resource does not declare `source`, which the new shared `ConfigSource` in `base/schemas/enums.yaml` defines. (#470)
- 685f4ea: **Breaking:** Before, a document's domain could come from its folder, its filename prefix or the `Domain` enum, which each contract set extended by overlay. Now every document that belongs to a domain declares it (`info.x-domain` on OpenAPI and AsyncAPI, a top-level `domain` elsewhere, mock data included), `Domain` is generated from the domains OpenAPI, AsyncAPI and rules documents declare, and validation reports a document that declares none or names one nothing defines. (#470)
- d833585: **Breaking:** Before, a state machine subscribed under `events:` and emitted full event names. Now it subscribes under `on:`, declares its resource's events once under `emits:` and sends them by name (`emit: claimed`), which resolve expands to `{domain}.{resource}.{event}`. (#470)
- 9b934ac: **Breaking:** Resolve now writes `<name>-events-asyncapi.yaml` beside each OpenAPI document, documenting every event its resources and their state machines send, so `x-events` and a state machine's `eventsSpec` are ignored, with a warning, and a hand-written channel for a generated event is a validation error. (#470)
- f6e9cd2: The base components now include `IdempotencyKeyParam`, an `Idempotency-Key` header an operation lists to require one key per create, and an `IdempotencyKeyReused` response for a key reused with a different request. (#470)
- f6e9cd2: Before, a state machine's guards applied only to its own actions, so nothing could refuse a record added under the object it governs. Now a machine's `resources:` declares guards for creating and updating its own object and the resources nested under it, at any depth. (#470)
- 4cc6217: **Breaking:** Before, validation held only lists at a path with no parameters to the list rules, so a nested list like `/applications/{applicationId}/members` could leave out `q`, `limit` or `offset`. Now any GET that returns a list is held to them; add `SearchQueryParam` where validation reports it missing.
- 9b19339: **Breaking:** Validation now fails on `nullable: true`, which OpenAPI 3.1 removed; write `type: [<type>, "null"]`, or `anyOf: [{ $ref: ... }, { type: "null" }]` for a reference. (#461)
- e5fe094: **Breaking:** Before, a route two contract documents declared was served from one of them silently, and an operation written by hand where a state machine transition or composition endpoint is generated was silently replaced by the generated one. Now the mock refuses to start and resolve refuses to generate, each naming both sources. (#470)
- e5fe094: **Breaking:** The event log's API (`/platform/events`, its stream, single events and publishing) now comes with the framework in every resolved contract set, and `safety-net-contracts` no longer declares its own. A contract set that declares `/platform/events` itself must remove it. (#470)
- 09aa7f4: **Breaking:** Every registry type a contract set declares is now served at `/platform/registry/{type}` and `/platform/registry/{type}/{entryId}`, with `/platform/registry` listing the types, read from the registry files themselves — files of a type combine, and an entry id two of them define fails, naming both. `safety-net-contracts` no longer declares `/registry/policies`, which the generic endpoint serves at the same URL. (#470)
- 274c4e4: **Breaking:** before, validation's "CEL syntax" check asked whether a rules expression parsed as JavaScript, so `$this.name` or `a?.b` passed. Now it parses expressions as CEL, and `@codeforamerica/blueprint-core/cel` exports the evaluator the mock server uses. (#445)
- 685f4ea: **Breaking:** before, a ruleset had an endpoint only if it declared one, and the endpoints were merged into the domain's OpenAPI document. Now every ruleset must declare `endpoint: {path}`, and a rules file's endpoints are documented in an OpenAPI document resolve generates beside it (`intake-rules-openapi.yaml`, from `generate(docs, 'rules-api')`), so clients generated from the domain's document no longer include them. (#470)
- adfa5e1: A contract set can now include the framework's `communication` capability by listing it in `x-capabilities`: `/communication/transcripts` records transcripts under a profile from `/communication/profiles`, with their timeline at `/transcripts/{id}/entries`. A new `x-enum-source: { registry: <type> }` form draws an enum from a registry. (#470)
- 6007c55: A scenario can now call the mock's own routes, such as registering a stub, by the operationIds in `contracts/mock-openapi.yaml` (`controlOperations(mock)` gives them to `runScenario`), with each step qualified as `$sourceDescriptions.<name>.<operationId>` when it names more than one source. (#470)
- f031c70: Before, a guarded action or create whose body was missing a field its condition read answered `409 No guard clause passed`, naming nothing. Now the body is checked against its schema first and answers 422, and a 409 reads as a sentence naming each unmet condition by the guard's new optional `description` or its id, or the states an action needs: `Can't pause this transcript. It requires that the transcript is recording, and it is closed.` (#470)

### Patch Changes

- 685f4ea: **Deprecated:** A state machine's `apiSpec` is ignored, and validation warns where it is still written, since each machine attaches to the resource in its domain named for its object. Remove it; it will be removed from the schema in a future minor version. (#470)
- fcd12bf: Before, `generate(docs, 'artifact')` carried every YAML file in the contracts directory, so a stray one — a mock forwarding file, a local config — was published in `contracts.json`. Now a file no contract type describes is left out unless a contract references it. (#283)
- adfa5e1: Before, `x-enum-source: states[].id` naming no machine took the states of whichever state machine resolve read last, so adding a state machine document could change another domain's enum. Now it takes the states of the annotated schema's own domain. (#470)
- c2df909: Before, `generate(docs, 'postman')` put all of an API's endpoints in one folder when the API had a base path, and filled its requests with ids that often named no record in the mock. Now each resource gets its own folder, filled with the records a mock seeds from the same set, and core no longer installs `pluralize`.

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
