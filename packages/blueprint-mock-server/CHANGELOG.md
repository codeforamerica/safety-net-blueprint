# Changelog

## 0.4.0

### Minor Changes

- Before, the server always chose a new record's id. Now a create may carry the id the caller chose, and one another record already has gets 409. (#516)
- **Breaking:** Where a composition named its resource by path segment or storage name, such as `resource: application-members`, name it by its schema, `resource: ApplicationMember`, as `x-relationship` does. A name that matches no schema now fails validation. (#516)
- **Breaking:** Where a config catalog was `queues: [...]`, write `queues: { resource: Queue, entries: [...] }`. Validation now fails when a seeded resource does not declare `source`, which the new shared `ConfigSource` in `base/schemas/enums.yaml` defines. (#470)
- **Breaking:** Before, a document's domain could come from its folder, its filename prefix or the `Domain` enum, which each contract set extended by overlay. Now every document that belongs to a domain declares it (`info.x-domain` on OpenAPI and AsyncAPI, a top-level `domain` elsewhere, mock data included), `Domain` is generated from the domains OpenAPI, AsyncAPI and rules documents declare, and validation reports a document that declares none or names one nothing defines. (#470)
- Before, changing an application and its members together took one request per record. Now a composition with `compositeType: editable` takes a JSON Patch (RFC 6902) at its endpoint, applied all or nothing through each record's own operations. (#516)
- **Breaking:** Before, a route two contract documents declared was served from one of them silently, and an operation written by hand where a state machine transition or composition endpoint is generated was silently replaced by the generated one. Now the mock refuses to start and resolve refuses to generate, each naming both sources. (#470)
- **Breaking:** Every registry type a contract set declares is now served at `/platform/registry/{type}` and `/platform/registry/{type}/{entryId}`, with `/platform/registry` listing the types, read from the registry files themselves — files of a type combine, and an entry id two of them define fails, naming both. `safety-net-contracts` no longer declares `/registry/policies`, which the generic endpoint serves at the same URL. (#470)
- **Breaking:** before, a ruleset had an endpoint only if it declared one, and the endpoints were merged into the domain's OpenAPI document. Now every ruleset must declare `endpoint: {path}`, and a rules file's endpoints are documented in an OpenAPI document resolve generates beside it (`intake-rules-openapi.yaml`), so clients generated from the domain's document no longer include them. (#470)
- **Breaking:** The mock now validates in JSON Schema 2020-12, the dialect OpenAPI 3.1 contracts declare, so a request with a field a closed schema does not declare gets a 422 naming the field, where before `unevaluatedProperties: false` was ignored. (#461)
- `runScenario` and `operationIndex`, from `./browser`, run an Arazzo scenario against the mock's `fetch` — or any fetch — step by step, returning each request, response and check, and refusing any Arazzo feature they do not support by name. (#470)
- Before, a scenario could take a value from a response only at a fixed place, such as `$response.body#/items/0/id`. Now the runner reads Arazzo 1.1 selectors, so a step can pick items out of a list by what they hold, as in `$.items[?@.status == 'proposed'].id`, and check a response with a JSONPath condition. (#469)
- The mock now makes a state machine step's call to an operation through the API, as the system — whose events carry `authid: system`, and which no client can claim to be — or with `runAs: caller` as the caller. A failed call runs the step's `catch:`, and with none, nothing the action or reaction did is saved. (#469)
- A scenario can now call the mock's own routes, such as registering a stub, by the operationIds in `contracts/mock-openapi.yaml` (`controlOperations(mock)` gives them to `runScenario`), with each step qualified as `$sourceDescriptions.<name>.<operationId>` when it names more than one source. (#470)
- A state machine's `evaluate:` step can now build an input from several values — `current: {incomes: $inputs.incomes}` — whose fields are resolved as a call's body is. Before, an input had to be a single value expression. (#469)
- **Breaking:** before, an event with no `traceparent`, `causationid`, `authid`, `authtype` or `data` carried each as `null`, and every event carried the store's `createdAt` and `updatedAt`. Now each absent attribute is left out, and an event's only timestamp is its `time`. (#470)
- **Breaking:** Before, create, update and delete events were named from the path, as `intake.application_income.created` or `data_exchange.…`. Now they are named for the resource and the domain as declared: `intake.income.created`, `data-exchange.…`. (#470)
- Before, a state machine's reactions to two quick changes to one application could run at the same time. Now each event carries a `partitionkey` — the application's id, for an income — and reactions to events with the same key run one at a time, in order. (#469)
- Before, reaching a real service meant leaving the mock entirely. Now `blueprint-mock --forwarding=<file>`, or `createMockServer({ forwarding })`, sends a whole domain or a single endpoint to a real service while everything else stays mocked, passing credentials along only where `includeHeaders` names them; `schemas/forwarding-schema.json` describes the file. (#283)
- Before, a create or update outside an action ran no guards. Now it runs the guards of every state machine that governs the resource under `resources:`, answering 403 or 409. (#470)
- An operation that declares the `Idempotency-Key` header now honors it: a repeat with the same key gets the stored response marked `Idempotent-Replayed: true`, the same key with a different request gets 422 `IDEMPOTENCY_KEY_REUSED`, a missing required key gets 400 `IDEMPOTENCY_KEY_MISSING`, and keys are scoped to the caller. (#470)
- **Breaking:** Before, a subscription without `transition:` got the event's payload as `$object` when the payload's `id` matched the event's `subject`. Now `$object` is the machine's own record, looked up by `subject`, and only for an event about the machine's own resource. (#463)
- **Breaking:** Where deleting a record left others naming it, the delete is now refused with 409, unless their relationship declares `onDelete: cascade`, which deletes them with it. (#516)
- **Breaking:** Event stubs take `response` where they took `respond`, and both kinds of stub now answer `422` naming any key they do not recognize — before, a misspelled key registered, listed and then did nothing. `schemas/stubs-schema.json` describes both. (#283)
- **Breaking:** Where a timer stub was registered `on: scheduling.timer.requested`, register it `on: platform.timer.requested`. (#469)
- **Breaking:** Where a write named a record that isn't there through a polymorphic reference, it now gets 422, checked against the resource its type field names. (#516)
- **Breaking:** Before, a POST to a path with no list and no item stored a record. Now it answers 501 unless an HTTP stub stands in. (#470)
- **Breaking:** Where a client could change a field marked `readOnly`, such as a state machine's `status`, by updating the record, it now gets 422. A state machine acting as the system still may, while a client sending the `system` role in `X-Caller-Roles` may not, and a value the server sets anyway passes. (#516)
- **Breaking:** guard conditions, `if:` and `match:` steps, composition filters and `x-derived` fields are now evaluated as CEL by a spec-compliant implementation, where a regex translation to JavaScript ran them before. Write names without `$` (`object.status`, `reviewTask != null`), list membership as `x in list`, and test a field that may be absent with `has()`. (#445)
- **Breaking:** A create or update whose `x-relationship` id, at any depth in the body, names no record the mock holds, or a record under a different parent than the write, is now refused with a 422 naming the field. A nested create under a parent that isn't there now gets a 404. (#481)
- A scenario step can now retry with Arazzo's `onFailure: [{ type: retry, retryAfter, retryLimit }]`, so a step checking what the mock does after it answers — a state machine's reaction to an event — passes once the reaction has run. `runScenario` refuses other failure actions by name. (#469)
- A scenario can now be split into sections, one workflow each: a workflow that `dependsOn` earlier ones runs after them, on the same mock, and reads what they produced as `$workflows.<id>.outputs.<name>`. When one it depends on fails, it fails without running. (#469)
- The mock now sets `slaDeadline` on a record whose schema declares it, when its SLA clocks start, and keeps it current as they pause and resume, where before it was never set. (#516)
- `startScenario` runs an Arazzo scenario a step at a time on the same server, and a step can upload a file as `multipart/form-data`, with each part the operation declares as a file given as `{ fileName, contentType, content }`. (#470)
- Before, a step's `call:` to a path with an id always ran an action, and an action's update steps were dropped. Now a call means what the API's route at that method and path means — a nested create, an update, or an action — and a path that means nothing is an error naming it. (#470)
- Before, a store could only save a record through `create` or `insertResource`, both of which add `createdAt` and `updatedAt`, and `restore()` added them to snapshotted records that had none. Now a store implements `append(collection, record)`, which saves a record exactly as given, and `restore()` writes each record as the snapshot has it; a custom store without `append` keeps working. (#470)
- The mock refuses a suggestion whose call names an operation the contracts don't have, parameters or a body that operation doesn't accept, or a JSON Patch with a change no `test` guards or a record that doesn't exist, with a `422`; and one repeating a suggestion still open or dismissed, or a patch whose `test` no longer holds, with a `409`. Set `MOCK_FINGERPRINT_SECRET` so stored suggestions still match after a restart. (#469, #517)
- `blueprint-swagger` now accepts `--spec` more than once, and the package ships `contracts/mock-openapi.yaml` describing the mock's own endpoints — health, stubs, reset and reseed — to show beside a contract set with `--spec=node_modules/@codeforamerica/blueprint-mock-server/contracts`. (#283)

### Patch Changes

- Before, a state machine's transitions were documented under its first machine's item path in the API its `apiSpec` named. Now each attaches to the resource it names, in whichever OpenAPI document of its domain declares it, so intake's Verification transitions appear under the verification. (#470)
- Each package now declares its license, `PolyForm-Noncommercial-1.0.0`, so npm and dependency scanners show it. The terms are unchanged. (#452)
- Before, a scenario step's `requestBody.contentType` was ignored unless it was `multipart/form-data`, so a JSON Patch went out as `application/json`. Now the step is sent as the media type it names. (#516)
- Before, a mock that failed spec validation at boot said only "Validation failed" and pointed at `npm run validate`. Now the error lists each failure with its API.
- Before, a request that failed validation in a browser came back as `500 INTERNAL_ERROR: process is not defined`. Now it returns the `422` naming the field, as it already did in Node. (#460)
- **Deprecated:** The mock reads a call's body from `requestBody: {payload: …}`. A call by method and path that still sends `body:` works, with a warning, until a future minor version removes it. (#469)
- Before, a composition field written as `source as alias` was silently left out of the response. Now the source field's value is returned under the alias, nested paths included. (#481)
- Before, a record an action's step created directly, with a `call:` by method and path, was stored with no `created` event, so nothing reacting to its creation ran. Now it sends the `created` event a create through the API would. (#469)
- Before, events from a request with no `traceparent` shared no trace, and state machine transitions recorded no `authid` or `authtype`. Now such a request starts a trace that every event it causes carries, and transition events record who acted, with `authtype` set whenever `authid` is. (#470)
- Before, an expanded relationship kept a foreign key the resolved schema drops, and a related record served at a path not named for it was never found. Now the response follows the resolved schema and the record is found wherever its API serves it. (#470)
- Before, a guarded action or create whose body was missing a field its condition read answered `409 No guard clause passed`, naming nothing. Now the body is checked against its schema first and answers 422, and a 409 reads as a sentence naming each unmet condition by the guard's new optional `description` or its id, or the states an action needs: `Can't pause this transcript. It requires that the transcript is recording, and it is closed.` (#470)
- **Deprecated:** Where a seed file or a stub wrote `$now+7d`, `$now-8h`, `$now+30m` or `$now+1w`, write the ISO 8601 duration — `$now+P7D`, `$now-PT8H`, `$now+PT30M`, `$now+P1W` — which also takes months and years (`$now+P1M`) and keeps the `@HH:MM` pin. The old form still works, with a warning, and will be removed in a future minor version. (#469)
- Before, a `links-only` link was built under the API holding it, so a determination linked to `/eligibility/applications/<id>` and a member to `/intake/application-members/<id>`. Now a link points at the related record's own route, parent ids filled in, and is left out when no loaded API serves it. (#481)
- Before, a state machine declaring no `actions` stopped the mock from starting. Now it starts, and the machine's resource begins in its initial state. (#469)
- Before, `/workflow/metrics` reported `0` for every count and ratio metric whatever the store held, and `groupBy` failed for a metric over any collection but tasks and events. Now it counts every matching record, windows events by their `time`, and pairs a duration's events by `subject` unless `pairBy` names another field. (#470)
- Before, a nested list ignored its `x-sortable`, a nested create was validated with its parent ids already in the body so a create schema allowing no extra fields refused it, and a JSON Logic binding searched only the first 25 records. Now a nested list is ordered as declared, the body is validated as sent, and a binding searches every record. (#470)
- Before, listing records nested under another, such as an application's members, failed with a 500 when they had a field to expand. Now the list comes back with those fields expanded.
- Before, a nested list such as `/applications/{applicationId}/members` ignored `q` and returned every record under its parent. Now it searches with `q` the same way a top-level list does.
- Before, the mock started with `blueprint-mock` skipped a state machine step's call to a record — pausing a transcript wrote no pause entry — while the same contracts in a page did it. Now both make the call. (#469)
- The mock started from the command line and the one built in a page are now set up the same way, so a page now fills in a service call's `serviceType`, `callMode` and `status` as the command-line server did, and a server started in the same process as an earlier one no longer answers that server's event stubs. (#516)
- Before, a contract declaring a path the mock serves itself, such as `/health` or `/mock/stubs/http`, was never reached. Now the mock refuses to start and names the route. (#283)
- Before, a state machine's `evaluate:` step in the mock in a page skipped its ruleset with a warning, while `blueprint-mock` ran it. Now both run it. (#469)
- A polymorphic reference declared `links-only` now comes back with a link to the record its type field names, and links now appear on records held inside a response, such as each evidence entry of a suggestion, and on resources that are a `oneOf` of kinds, where before they were left out. (#517)
- Before, a record a procedure's step created directly started no SLA clocks, and its `created` event named the system as who acted. Now its clocks start, and the event names whoever ran the action or reaction that called the procedure. (#469)
- Before, a procedure called from inside a `forEach` had its `with:` arguments read after the loop, so `with: { id: $id }` didn't see the item. Now they're read where the call stands, giving each call its own item. (#469)
- A procedure an action calls now reads the record as the action left it, with its steps applied and its SLA clocks updated, where before it read the record as it was before the action. (#516)
- Before, a step that read `$object` after a `set` saw the record as it was before the action began; a timer requested for a deadline just set got none. Now later steps see the value set. (#469)
- Before, a record created through the mock never started its SLA clocks. Now creating one starts the clocks of the SLA types that apply to it — through the API or by a state machine's step — and returns `slaInfo` as the `SlaInfo` contract describes it, without the engine's own tracking fields. (#469)
- Before, stubs registered on one mock server were still in place on the next one created in the same process. Now each server starts with none. (#470)
- Before, `validate-mock-data` reported a record whose relationship the contracts expand as having an unknown property when the record it pointed at was seeded from config, such as a transcript's profile, though the server booted on it fine. Now it seeds first and checks records as the server serves them. (#469)
- Uses @codeforamerica/blueprint-core 0.4.0, @codeforamerica/blueprint-rules-engine 0.2.0.

## 0.3.0

### Minor Changes

- Before, `blueprint-mock` could only start from a contracts directory. Now `--spec=contracts.json` starts it from a bundled artifact, and seeding, reseed and mock-data validation all read from that file. (#448) Mock-data validation no longer requires an `x-derived` field of a seed record: the seed is what is stored, a derived field is computed at read time, so requiring it failed every record in a set that declared one. (#460)
- **Breaking:** before, uploading a document wrote its bytes to disk and `GET /document-versions/{id}/content` returned them. Now nothing is written and that endpoint returns a JSON object describing the file — name, type, size, hash, upload time — so a `snapshot()` can never carry real uploaded content. (#448)
- Before, reaching mock behavior meant starting a server and sending it an HTTP request. Now every endpoint is a `(Request) => Response` function in a route table — exported from `./routes`, returned by `startMockServer`, and wrapped as a single `fetch` by `createMockServer({ contracts })` on the new `./browser` export, which runs the whole mock in a page, with `basePath` for one served from a subdirectory. Because that is `fetch`'s own signature, pointing one endpoint at a real service is `routes.get('POST /x').handler = fetch`. (#448)
- Before, a spec with a `$ref` naming something outside the contract set stopped the server from starting. Now it starts, and warns that no validator could be compiled for that schema — so requests to the affected endpoint are accepted unchecked. `blueprint-validate` reports the bad ref instead. (#448)
- Before, installing the package brought in Express, `cors` and `multer`. Now the server runs on `node:http` and those are gone, with `express` remaining only for the optional `blueprint-swagger` bin. (#448)
- Before, running the mock server meant SQLite on disk and a native module. Now `--store=memory` keeps resources in memory with neither, and `createMemoryStore` is available on its own from the new `./store` export; SQLite stays the default. (#448)
- **Breaking:** before, `blueprint-mock --uploads=<dir>` and `MOCK_UPLOADS_DIR` chose where uploaded files were written. Now no files are written: both are gone, and `startMockServer(specDirs, seedDir, storeKind)` drops the `uploadsDir` parameter that was third of four. (#448)

### Patch Changes

- Before, declaring `parentLink: true` on a composition silently turned off expand, links-only and derived fields for that resource's `GET` — the handler returned the record with `_links` before any of them ran. Now the links are merged into the transformed response. (#448)
- Before, creating a resource under a spec that declares no localhost server URL emitted an event typed `".application.created"` — a leading dot and no domain, which nothing could subscribe to. Now the domain segment is omitted. (#448)
- Before, a contract set with a metric counting anything other than `tasks` or `events` got a 500 from the metrics endpoint. Now the collections come from the metric definitions, so counting applications or determinations works. (#448)
- Before, a state machine subscription whose steps emit an event never produced it — the emit threw internally, the error was caught and logged, and the transition that triggered the subscription still succeeded, so the event was simply missing. Now it reaches the event log. (#448)
- Before, starting a second mock server in one process left the first one's event subscriptions attached, so every event was handled twice — a test suite had to clear listeners between runs to get a single result. Now registering subscriptions replaces the previous handler. (#448)
- Uses @codeforamerica/blueprint-core 0.3.0.

## 0.2.0

### Minor Changes

- The mock server now serves a POST endpoint for every ruleset that declares
  one, evaluating the compiled graph against the request body and returning
  every fact with its state. (#425)

## [Unreleased]

## [1.2.0] - 2026-03-17

### Added

- Cross-resource search handler querying across persons, cases, applications, tasks, and appointments databases
- Support for `types` parameter to filter search results by resource type
- Facet counts per resource type in search results with merged pagination
- Rule evaluation engine with rules loader, action handlers, and condition matching
- Queue resource seeding and route registration
- `onCreate` effects in create handler (audit events + rule evaluation)
- `evaluate-rules` effects in transition handler (re-evaluation on release)

### Changed

- Route generator now routes `operationId=search` to custom search handler
- Search result attributes include `field` key for machine-readable access; `label` optional; simplified type enum

### Fixed

- Integration test now skips POST validation test for GET-only APIs (e.g., search API)
- Postman generator matches examples to endpoints by resource type instead of applying all examples to every endpoint

## [1.1.0] - 2026-03-03

### Added

- State machine engine integration: transition handler, state machine loader, RPC overlay generator
- State machine route registration in mock server setup and route generator
- Create effects and audit events: `resolveValue()` with `$now` and `$object.*`, `applyCreateEffect()`, pending creates
- `deriveCollectionName()` in route generator for multi-resource APIs
- Case Management and Scheduling API route support
- X-Caller-Id to CORS allowed headers
- Unit tests for state machine engine, loader, overlay generator, rules engine, and action handlers
- Integration tests for audit events and rule evaluation across task lifecycle

### Changed

- All CRUD handlers now use `endpoint.collectionName`
- Seeder clears all collections for an API on startup, not just the primary
- Collection names derived from path segments instead of API name

### Fixed

- Seeder now clears-then-reseeds instead of skip-if-exists, so deleted examples restore on restart
- Path param extraction uses `endpoint.path` instead of deriving from `apiMetadata.name`
- Postman generator sort order: `GET` (order 0) no longer treated as falsy
- Windows `fileURLToPath` check in `server.js`
- Removed `/workflow/` prefix from workflow spec paths for consistency

## [1.0.0] - 2026-01-15

### Added

- Express 5.x mock server with auto-discovery of `*-openapi.yaml` specs
- SQLite database per spec with automatic seeding from example files
- CRUD operation handlers (list, create, get, update, delete)
- Dynamic route registration from OpenAPI specs
- Search support via `q` parameter with patterns from `api-patterns.yaml`
- Swagger UI server (separate port)
- Database reset command (`mock:reset`)
- Preflight integration test infrastructure with newman/Postman collections
- npm workspace packaging and publishing infrastructure
