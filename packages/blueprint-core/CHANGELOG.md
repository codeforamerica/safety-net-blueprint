# @codeforamerica/blueprint-core

## 0.4.0

### Minor Changes

- A contract set can now include Arazzo scenarios — files ending `.arazzo.yaml`, declaring their domain in `info.x-domain` — which resolve carries with the other contracts and `validate` checks: each step must call an operation the set has, generated ones included, and refer only to earlier steps. (#470)
- Before, a state machine's transitions were documented under its first machine's item path in the API its `apiSpec` named. Now each attaches to the resource it names, in whichever OpenAPI document of its domain declares it, so intake's Verification transitions appear under the verification. (#470)
- A state machine action, procedure or reaction to an event can now call an operation — `call: { operationId, parameters, requestBody: { payload } }` — through the API, as the system by default or with `runAs: caller` as whoever triggered it, with `catch: { as, do, to }` for when it fails and `bind:` to keep what it answered. Validation refuses an `operationId` the set has no operation for, naming the capability to list when the operation belongs to one. (#469)
- **Breaking:** Before, a `call:` step written as `{ path:, method: }` passed validation and then silently did nothing. Now its object form must have exactly one method key (`POST`, `PATCH`, `GET` or `DELETE`, its value the path), with only `body` and `description` beside it. (#463)
- Before, a rule couldn't total a list, so totals like a member's income across jobs had to arrive as inputs. Now CEL expressions can call `list.sum()`, defined as Kubernetes' CEL list library defines it.
- A context binding's `where` can now be a CEL string, true for the record to bind, with the candidate record as `item` beside `object` and `request`. (#470)
- Before, the server always chose a new record's id. Now a create may carry the id the caller chose, and one another record already has gets 409. (#516)
- **Breaking:** Before, a composition with no `endpoint:` was silently never served. Now every composition must declare `endpoint: {path}`, a well-formed path with no trailing slash, and validation refuses a route that two rulesets, compositions, actions or operations claim, naming both. (#470)
- **Breaking:** Where a composition named its resource by path segment or storage name, such as `resource: application-members`, name it by its schema, `resource: ApplicationMember`, as `x-relationship` does. A name that matches no schema now fails validation. (#516)
- **Breaking:** Where a composition declared `state`, make it `compositeType: sectionView`; where `endpoint.methods` listed anything but `get`, remove it, and use `compositeType: editable` for a composition clients change. (#516)
- **Breaking:** Where a config catalog was `queues: [...]`, write `queues: { resource: Queue, entries: [...] }`. Validation now fails when a seeded resource does not declare `source`, which the new shared `ConfigSource` in `base/schemas/enums.yaml` defines. (#470)
- **Breaking:** Before, a document's domain could come from its folder, its filename prefix or the `Domain` enum, which each contract set extended by overlay. Now every document that belongs to a domain declares it (`info.x-domain` on OpenAPI and AsyncAPI, a top-level `domain` elsewhere, mock data included), `Domain` is generated from the domains OpenAPI, AsyncAPI and rules documents declare, and validation reports a document that declares none or names one nothing defines. (#470)
- Before, changing an application and its members together took one request per record. Now a composition with `compositeType: editable` takes a JSON Patch (RFC 6902) at its endpoint, applied all or nothing through each record's own operations. (#516)
- **Breaking:** Before, a state machine subscribed under `events:` and emitted full event names. Now it subscribes under `on:`, declares its resource's events once under `emits:` and sends them by name (`emit: claimed`), which resolve expands to `{domain}.{resource}.{event}`. (#470)
- An event can now carry the CloudEvents `partitionkey`: a subscriber handles events with the same key one at a time, in the order they occurred. (#469)
- A state machine's `extends` now resolves by its path from the extending file, as a `$ref` does. Before, it matched any state machine with the same filename anywhere in the set, so it could pick the wrong one; a set whose `extends` path doesn't lead to the file now gets an error naming it. Bundling one domain with `--domain` now keeps the state machine it extends. (#520)
- **Breaking:** Resolve now writes `<name>-events-asyncapi.yaml` beside each OpenAPI document, documenting every event its resources and their state machines send, so `x-events` and a state machine's `eventsSpec` are ignored, with a warning, and a hand-written channel for a generated event is a validation error. (#470)
- A state machine guard can now carry an optional `description`, which the mock server uses to name the condition when a request doesn't meet it. (#470)
- **Breaking:** A writable field named `…Id` that holds a uuid must now declare `x-relationship`, or validation fails with `id-without-relationship`; before, it passed as a link that nothing could follow. (#481)
- The base components now include `IdempotencyKeyParam`, an `Idempotency-Key` header an operation lists to require one key per create, and an `IdempotencyKeyReused` response for a key reused with a different request. (#470)
- Before, a state machine's guards applied only to its own actions, so nothing could refuse a record added under the object it governs. Now a machine's `resources:` declares guards for creating and updating its own object and the resources nested under it, at any depth. (#470)
- **Breaking:** Before, validation held only lists at a path with no parameters to the list rules, so a nested list like `/applications/{applicationId}/members` could leave out `q`, `limit` or `offset`. Now any GET that returns a list is held to them; add `SearchQueryParam` where validation reports it missing.
- **Breaking:** Validation now fails on `nullable: true`, which OpenAPI 3.1 removed; write `type: [<type>, "null"]`, or `anyOf: [{ $ref: ... }, { type: "null" }]` for a reference. (#461)
- **Breaking:** Before, a subscription without `transition:` to an event about another resource passed validation while reading `$object`, which it doesn't have. Now that fails validation; read the record's id from `$this.subject` and what the event carries from `$this.data`. (#463)
- Before, a contract couldn't say what deleting a record does to the records that name it. Now `x-relationship` takes `onDelete: cascade`, following OData's `OnDelete`, to delete them with it. (#516)
- **Breaking:** Before, a route two contract documents declared was served from one of them silently, and an operation written by hand where a state machine transition or composition endpoint is generated was silently replaced by the generated one. Now the mock refuses to start and resolve refuses to generate, each naming both sources. (#470)
- **Breaking:** Before, an overlay target with an index (`$.machines[0]`), a quoted name (`outputs['risks.earnedIncomeVaries']`) or other syntax overlays don't support matched nothing, and the action was skipped with a warning. Now indexes and quoted names work, and any other syntax, such as a wildcard (`[*]`), fails resolve with an error naming the target. (#502)
- **Breaking:** The event log's API (`/platform/events`, its stream, single events and publishing) now comes with the framework in every resolved contract set, and `safety-net-contracts` no longer declares its own. A contract set that declares `/platform/events` itself must remove it. (#470)
- **Breaking:** Every registry type a contract set declares is now served at `/platform/registry/{type}` and `/platform/registry/{type}/{entryId}`, with `/platform/registry` listing the types, read from the registry files themselves — files of a type combine, and an entry id two of them define fails, naming both. `safety-net-contracts` no longer declares `/registry/policies`, which the generic endpoint serves at the same URL. (#470)
- **Breaking:** Where a state machine emitted `scheduling.timer.requested` or `scheduling.timer.cancelled`, emit `platform.timer.requested` or `platform.timer.cancelled`, which every contract set now gets from the framework. Their payload schemas are renamed `TimerRequestedEvent` and `TimerCancelledEvent`. (#469)
- **Breaking:** Where a field declares `resource: Polymorphic`, name its type field in `discriminator.propertyName` and make that field an enum whose values name resources, or validation fails. A set including transcripts or suggestions gives their type fields values by overlay. (#516)
- **Breaking:** before, validation's "CEL syntax" check asked whether a rules expression parsed as JavaScript, so `$this.name` or `a?.b` passed. Now it parses expressions as CEL, and `@codeforamerica/blueprint-core/cel` exports the evaluator the mock server uses. (#445)
- **Breaking:** Where you passed `generate(docs, 'overlay')` to `resolve`, pass only your own overlays: `resolve` now adds the endpoints compositions, rulesets and state machine actions imply after applying them, so those endpoints follow what the overlays changed. `generate` no longer offers `'overlay'`. (#500)
- Before, a value a ruleset needed but no caller should send, such as a conversion factor, had to be an input with a default, and every result resting on it came back as a placeholder. Now a ruleset declares it under `constants`, facts read it as `constants.<name>`, and the compiled graph carries its value. An input named `constants` alongside the block is refused. (#481)
- **Breaking:** before, a ruleset had an endpoint only if it declared one, and the endpoints were merged into the domain's OpenAPI document. Now every ruleset must declare `endpoint: {path}`, and a rules file's endpoints are documented in an OpenAPI document resolve generates beside it (`intake-rules-openapi.yaml`), so clients generated from the domain's document no longer include them. (#470)
- Before, a fact whose path had a dot passed the rules schema but failed graph and annotation validation. Now a dot groups facts, as `risks.earnedIncomeVaries`, and the fact keeps its whole path in expressions, in the answer and in annotation keys. (#481)
- Before, a decision made for each item of a list and then about the whole, such as whether each review month counts and then whether enough did, couldn't be written in one ruleset. Now a list fact names its items with `as`, a fact at `reviewMonths[].qualifies` is computed once for each item, a compiled graph declares its `formatVersion` (`1.1` with per-item facts, `1.0` without), and `inputOf(graph, factPath)` from `@codeforamerica/blueprint-core/cel` says which input a list fact's items come from. (#496)
- **Breaking:** A ruleset endpoint's response is now described as an object keyed by output name, where `EvaluationResult` described an array of facts each with a `fact` field: read a result by name, as `#/eligible/value`. Each ruleset's generated response schema lists its outputs, each `value` typed as the ruleset declares it. (#469)
- **Breaking:** Validation now refuses a ruleset where a name would mean two things: a fact declared twice, a fact starting with an input's name, or a path that's both a fact and a group. (#481)
- The SLA schemas are now defined in `base/schemas/sla.yaml`, with `base/components/sla.yaml` referring to them as before, and there's a new `SlaDeadline`: the earliest deadline among a record's running SLA clocks, null when none is, which a record with `slaInfo` may declare as `slaDeadline`. (#516)
- A contract set can now include suggestions by listing `suggestions` in `x-capabilities`: `/decision-support/suggestions` records a call to an operation, such as a JSON Patch to an editable composition that adds a member and their income together, or a note about a record, proposed to a person, who accepts it, dismisses it with a reason, or lets it expire. Accepting a proposed call makes it, as the person accepting or as they corrected it, and a proposal repeating one still open or dismissed is refused with `409`. (#469, #517)
- A state machine step's value can now be a time from now — `$now`, then `+` or `-` and an ISO 8601 duration, as in `$now+P1D` — to store a deadline on the record, which a timer's `fireAt` can then read. (#469)
- Before, the event a timer service sends when a state machine's timer fires, such as `decision-support.suggestion_expiry`, had no channel in the generated AsyncAPI. Now each timer a machine declares gets one, carrying `TimerCallbackEvent`, and the timer schemas say the callback keeps the request's `subject` and sets `causationid` to the request's id. (#469)
- A contract set can now include the framework's transcripts by listing the `transcripts` capability in `x-capabilities`: `/communication/transcripts` records transcripts under a profile from `/communication/profiles`, with their timeline at `/transcripts/{id}/entries`, and validation names the capability when a set refers to one it hasn't listed. A new `x-enum-source: { registry: <type> }` form draws an enum from a registry. (#470, #469)
- **Breaking:** An update operation whose request schema takes a field the record it returns marks `readOnly` now fails validation; take the field off the update, or change it through a state machine action. (#516)
- A scenario can now call the mock's own routes, such as registering a stub, by the operationIds in `contracts/mock-openapi.yaml` (`controlOperations(mock)` gives them to `runScenario`), with each step qualified as `$sourceDescriptions.<name>.<operationId>` when it names more than one source. (#470)

### Patch Changes

- Before, an endpoint generated from a state machine action listed only 400, 404, 409 and 500, and required a request body even when its schema required nothing. Now it also lists 403, and 422 when it takes a body or calls another operation, and its body is required only when its schema requires a field. (#469)
- Before, an actor role missing from `RoleType` was reported as `Invalid actor role`, which read like a broken contract. Now the message says roles are added by an overlay on `RoleType`, and that a package's contracts need the package's own overlays applied. (#478)
- Before, `validate` checked an annotation's fact keys only against compiled graphs in the set, so `blueprint-resolve`, which validates before compiling them, passed an annotation naming a fact no ruleset declares. Now it reads each ruleset's facts from its rules document.
- **Deprecated:** A state machine's `apiSpec` is ignored, and validation warns where it is still written, since each machine attaches to the resource in its domain named for its object. Remove it; it will be removed from the schema in a future minor version. (#470)
- Validating a scenario now checks its actors: each actor in `info.x-actors` needs an id and a name, listed once, and a step's `x-actors` may name only those ids. (#517)
- Validating a scenario now checks references between its workflows: `$workflows.<id>.outputs.<name>` must name a workflow the step's own `dependsOn` lists, and an output it declares, and `dependsOn` must name a workflow the document has. (#469)
- Before, `generate(docs, 'artifact')` carried every YAML file in the contracts directory, so a stray one — a mock forwarding file, a local config — was published in `contracts.json`. Now a file no contract type describes is left out unless a contract references it. (#283)
- **Deprecated:** Where a state machine step wrote `call: {POST: some/path, body: {…}}`, write `call: {POST: some/path, requestBody: {payload: {…}}}`, as a call by `operationId` and an Arazzo step do. Validation warns about `body:`, and it will be removed in a future minor version. (#469)
- Before, a composition field written as `source as alias`, the form the compositions schema documents, failed validation as a field named `source as alias`. Now the source field is checked. (#481)
- Before, validation didn't compare the `data:` an emit step sends with the schema its event declares. Now a required property not sent, a property the schema doesn't declare when it allows no others, or data on an event that declares no schema is an `emit-data` error. (#469)
- Before, `x-enum-source: states[].id` naming no machine took the states of whichever state machine resolve read last, so adding a state machine document could change another domain's enum. Now it takes the states of the annotated schema's own domain. (#470)
- Before, an expanded relationship's subset gave a field the type `string` when the related resource declared it in a part it references — the `Writable` half of `allOf: [$ref ApplicationWritable, …]` — so an expanded application's `programsAppliedFor`, a list, was described as a string, and a record carrying it was refused. Now the field keeps its declared type. (#469)
- Before, a retried `addTranscriptEntry` came back with an `Idempotent-Replayed` header no contract declared. Now the base components declare it as `IdempotentReplayed` in `components/headers.yaml`, and every operation that takes an `Idempotency-Key` lists it on its success response. (#516)
- Before, an action whose id has several words, such as `process-suggestions` on Interview, got the operationId `process-suggestionsInterview`. Now it's camelCased: `processSuggestionsInterview`. (#469)
- A polymorphic reference that declares `style: links-only` now gets a `links` entry in the resolved schema, where before resolve left it alone; the set's style still doesn't reach one, and `expand` still leaves it alone. Suggestion evidence declares it, so each entry's `links.source` says where to read what it cites. (#517)
- Before, `generate(docs, 'postman')` put all of an API's endpoints in one folder when the API had a base path, and filled its requests with ids that often named no record in the mock. Now each resource gets its own folder, filled with the records a mock seeds from the same set, and core no longer installs `pluralize`.
- Before, validation accepted a state machine call that `$push`es an item with a value its list doesn't allow, such as `{source: not_a_real_source}`. Now that's an `invalid-push-enum-value` error. (#469)
- Before, a ruleset input that `$ref`d a schema in another file stopped at that file's own refs, so fields under them, such as a list item's date of birth, were never declared. Now refs are followed from the file they're written in. (#481)
- Before, a ruleset reading a list given as an input of its own, such as `programsAppliedFor`, compiled to a graph that failed validation. Now its dependencies validate. (#481)
- Before, the `q` parameter's description didn't say how a condition on a list matches. Now it does: when any item matches, with each condition checked on its own, so `members.firstName:Jo members.age:>60` can match two different members. (#469)
- Each package now declares its license, `PolyForm-Noncommercial-1.0.0`, so npm and dependency scanners show it. The terms are unchanged. (#452)
- A timer request's `fireAfter` now declares the ISO 8601 `duration` format, and `fireOffset` a pattern for a duration that may be negative (`-PT48H`). (#469)
- Before, a transcript's `startedAt` was marked `readOnly` even though the client sets it at create. Now it isn't, and an update still can't change it. (#516)
- Before, `discover` left out a contract file that wasn't valid YAML, so `validate` passed and the set ran without it — a state machine with a typo simply wasn't there. Now `discover` and `load` throw, naming the file and the line and column where it fails. (#469)

## 0.3.0

### Minor Changes

- Before, `extract` and `generate` only ran in Node, because importing either one pulled the filesystem in with it. Now the new `./browser` export runs them in a page: `generate(docs, 'artifact')` turns a contract set into one serializable object, `extract(artifact, 'docs')` turns it back into documents, and `{ domains: ['intake'] }` narrows it to the domains you name. (#448)
- **Breaking:** `resolve()` no longer returns a `manifest`, and a `Doc` no longer carries `provenance` or `resolved`. Nothing wrote the manifest file those fields were read from, so `resolved` was always `false` and `provenance` always `null`. (#448)
- **Breaking:** where you called `generate(docs, 'examples')`, call `extract(docs, 'examples')`. The output is unchanged. (#448)
- Before, reading a state machine, SLA type set, metric, config or registry out of a contract set meant locating the documents and merging them yourself, and a cross-file `$ref` was read off disk. Now `extract(docs, type)` reads `'state-machines'`, `'sla-types'`, `'metrics'`, `'config'` and `'registries'` — `extract(docs, 'registries').policies` returns the policies registry, merged across every document that contributes to it — and refs resolve against the documents you passed in. (#448)
- **Breaking:** before, `validate` silently ignored a `$ref` naming a document outside the set, an `x-relationship.resource` naming no schema, and a state machine declaring `machines` without a `domain`. Now each is an error, so a contract set that passed before may report new ones. (#448)

### Patch Changes

- Before, a `${VAR}` placeholder in an overlay's `config:` block was used verbatim — `x-event-type-prefix: ${EVENT_PREFIX}` prefixed every event type with that literal text, silently. Now config values are substituted like the rest of the contract set, so a cross-cutting setting can vary by environment, and `resolve()` reports the names of any placeholders that found no value. (#464)
- Before, a document in `domains/scheduling/` had no domain unless it declared one itself, so `scheduling-openapi.yaml` was in the scheduling domain and `scheduling-mock-data.yaml` was in none. Now the directory name supplies it; `base/` and `common/` stay domainless. (#448)
- Before, `doc.externalRefs(docs)` and `doc.resolveRef` could disagree about the same ref, and `externalRefs` needed a filesystem to answer at all. Now both resolve against the set's relative paths — and a document loaded on its own, with no `relativePath`, no longer finds its siblings. (#448)
- Before, an operation could declare a `sort` query parameter while the server rejected every `?sort=` it advertised, because sorting is gated on a separate `x-sortable` extension and nothing checked the two agreed. Now `validate` warns when a sort parameter is declared without one. (#448)

## 0.2.0

### Minor Changes

- **Breaking:** `blueprint-core` now has one entry point instead of seventeen
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
- **Deprecated:** The `policies-schema.yaml` registry format (`policies:` map) is
  superseded by `registry-schema.yaml` (`type: policies`, `entries:` map). Named
  registry files (`*-registry-{type}.yaml`) are discovered automatically. Both
  formats are supported; the old one will be removed in a future minor version.
- **Breaking:** JSON schema validation no longer strips `$schema` before
  validating. A schema with `additionalProperties: false` that does not declare
  `$schema` will now fail; add `$schema: { type: string }` to its properties.

  `blueprint-core` also gains rules contract support: a schema for
  `*-rules.yaml`, a compiler producing portable `*-graph.yaml` dependency
  graphs, a validator with cycle and unreachable-node detection and CEL syntax
  checking, and an endpoint overlay generator. (#425)
- **Breaking:** Annotation files key fields by spec-relative path
  (`application.members[].dateOfBirth`) rather than schema-relative path
  (`member.dateOfBirth`). The first segment is the camelCase schema name,
  followed by the dot-bracket field path. This matches the data dictionary and
  the field inventory, so one path form works across all three.

## 0.1.1

### Patch Changes

- `blueprint-resolve` now exits with a clear error if `blueprint-core`'s base contracts are missing, rather than silently producing broken output. The `base-contracts/` and `assets/` directories are now correctly included in the `blueprint-core` npm package, fixing resolution failures for consumers who installed from npm.
