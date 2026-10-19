# Changelog

## 0.4.0

### Minor Changes

- **Breaking:** Where a config catalog was `queues: [...]`, write `queues: { resource: Queue, entries: [...] }`. Validation now fails when a seeded resource does not declare `source`, which the new shared `ConfigSource` in `base/schemas/enums.yaml` defines. (#470)
- **Breaking:** Before, a document's domain could come from its folder, its filename prefix or the `Domain` enum, which each contract set extended by overlay. Now every document that belongs to a domain declares it (`info.x-domain` on OpenAPI and AsyncAPI, a top-level `domain` elsewhere, mock data included), `Domain` is generated from the domains OpenAPI, AsyncAPI and rules documents declare, and validation reports a document that declares none or names one nothing defines. (#470)
- **Breaking:** Before, a route two contract documents declared was served from one of them silently, and an operation written by hand where a state machine transition or composition endpoint is generated was silently replaced by the generated one. Now the mock refuses to start and resolve refuses to generate, each naming both sources. (#470)
- **Breaking:** Every registry type a contract set declares is now served at `/platform/registry/{type}` and `/platform/registry/{type}/{entryId}`, with `/platform/registry` listing the types, read from the registry files themselves — files of a type combine, and an entry id two of them define fails, naming both. `safety-net-contracts` no longer declares `/registry/policies`, which the generic endpoint serves at the same URL. (#470)
- **Breaking:** before, a ruleset had an endpoint only if it declared one, and the endpoints were merged into the domain's OpenAPI document. Now every ruleset must declare `endpoint: {path}`, and a rules file's endpoints are documented in an OpenAPI document resolve generates beside it (`intake-rules-openapi.yaml`, from `generate(docs, 'rules-api')`), so clients generated from the domain's document no longer include them. (#470)
- **Breaking:** The mock now validates in JSON Schema 2020-12, the dialect OpenAPI 3.1 contracts declare, so a request with a field a closed schema does not declare gets a 422 naming the field, where before `unevaluatedProperties: false` was ignored. (#461)
- `runScenario` and `operationIndex`, from `./browser`, run an Arazzo scenario against the mock's `fetch` — or any fetch — step by step, returning each request, response and check, and refusing any Arazzo feature they do not support by name. (#470)
- A scenario can now call the mock's own routes, such as registering a stub, by the operationIds in `contracts/mock-openapi.yaml` (`controlOperations(mock)` gives them to `runScenario`), with each step qualified as `$sourceDescriptions.<name>.<operationId>` when it names more than one source. (#470)
- **Breaking:** before, an event with no `traceparent`, `causationid`, `authid`, `authtype` or `data` carried each as `null`, and every event carried the store's `createdAt` and `updatedAt`. Now each absent attribute is left out, and an event's only timestamp is its `time`. (#470)
- **Breaking:** Before, create, update and delete events were named from the path, as `intake.application_income.created` or `data_exchange.…`. Now they are named for the resource and the domain as declared: `intake.income.created`, `data-exchange.…`. (#470)
- Before, reaching a real service meant leaving the mock entirely. Now `blueprint-mock --forwarding=<file>`, or `createMockServer({ forwarding })`, sends a whole domain or a single endpoint to a real service while everything else stays mocked, passing credentials along only where `includeHeaders` names them; `schemas/forwarding-schema.json` describes the file. (#283)
- Before, a create or update outside an action ran no guards. Now it runs the guards of every state machine that governs the resource under `resources:`, answering 403 or 409. (#470)
- An operation that declares the `Idempotency-Key` header now honors it: a repeat with the same key gets the stored response marked `Idempotent-Replayed: true`, the same key with a different request gets 422 `IDEMPOTENCY_KEY_REUSED`, a missing required key gets 400 `IDEMPOTENCY_KEY_MISSING`, and keys are scoped to the caller. (#470)
- **Breaking:** Before, a subscription without `transition:` got the event's payload as `$object` when the payload's `id` matched the event's `subject`. Now `$object` is the machine's own record, looked up by `subject`, and only for an event about the machine's own resource. (#463)
- **Breaking:** Event stubs take `response` where they took `respond`, and both kinds of stub now answer `422` naming any key they do not recognize — before, a misspelled key registered, listed and then did nothing. `schemas/stubs-schema.json` describes both. (#283)
- **Breaking:** Before, a POST to a path with no list and no item stored a record. Now it answers 501 unless an HTTP stub stands in. (#470)
- **Breaking:** guard conditions, `if:` and `match:` steps, composition filters and `x-derived` fields are now evaluated as CEL by a spec-compliant implementation, where a regex translation to JavaScript ran them before. Write names without `$` (`object.status`, `reviewTask != null`), list membership as `x in list`, and test a field that may be absent with `has()`. (#445)
- **Breaking:** A create or update whose `x-relationship` id, at any depth in the body, names no record the mock holds, or a record under a different parent than the write, is now refused with a 422 naming the field. A nested create under a parent that isn't there now gets a 404. (#481)
- `startScenario` runs an Arazzo scenario a step at a time on the same server, and a step can upload a file as `multipart/form-data`, with each part the operation declares as a file given as `{ fileName, contentType, content }`. (#470)
- Before, a step's `call:` to a path with an id always ran an action, and an action's update steps were dropped. Now a call means what the API's route at that method and path means — a nested create, an update, or an action — and a path that means nothing is an error naming it. (#470)
- Before, a store could only save a record through `create` or `insertResource`, both of which add `createdAt` and `updatedAt`, and `restore()` added them to snapshotted records that had none. Now a store implements `append(collection, record)`, which saves a record exactly as given, and `restore()` writes each record as the snapshot has it; a custom store without `append` keeps working. (#470)
- `blueprint-swagger` now accepts `--spec` more than once, and the package ships `contracts/mock-openapi.yaml` describing the mock's own endpoints — health, stubs, reset and reseed — to show beside a contract set with `--spec=node_modules/@codeforamerica/blueprint-mock-server/contracts`. (#283)

### Patch Changes

- Before, a state machine's transitions were documented under its first machine's item path in the API its `apiSpec` named. Now each attaches to the resource it names, in whichever OpenAPI document of its domain declares it, so intake's Verification transitions appear under the verification. (#470)
- Each package now declares its license, `PolyForm-Noncommercial-1.0.0`, so npm and dependency scanners show it. The terms are unchanged. (#452)
- Before, a mock that failed spec validation at boot said only "Validation failed" and pointed at `npm run validate`. Now the error lists each failure with its API.
- Before, a request that failed validation in a browser came back as `500 INTERNAL_ERROR: process is not defined`. Now it returns the `422` naming the field, as it already did in Node. (#460)
- Before, a composition field written as `source as alias` was silently left out of the response. Now the source field's value is returned under the alias, nested paths included. (#481)
- Before, events from a request with no `traceparent` shared no trace, and state machine transitions recorded no `authid` or `authtype`. Now such a request starts a trace that every event it causes carries, and transition events record who acted, with `authtype` set whenever `authid` is. (#470)
- Before, an expanded relationship kept a foreign key the resolved schema drops, and a related record served at a path not named for it was never found. Now the response follows the resolved schema and the record is found wherever its API serves it. (#470)
- Before, a guarded action or create whose body was missing a field its condition read answered `409 No guard clause passed`, naming nothing. Now the body is checked against its schema first and answers 422, and a 409 reads as a sentence naming each unmet condition by the guard's new optional `description` or its id, or the states an action needs: `Can't pause this transcript. It requires that the transcript is recording, and it is closed.` (#470)
- Before, a `links-only` link was built under the API holding it, so a determination linked to `/eligibility/applications/<id>` and a member to `/intake/application-members/<id>`. Now a link points at the related record's own route, parent ids filled in, and is left out when no loaded API serves it. (#481)
- Before, `/workflow/metrics` reported `0` for every count and ratio metric whatever the store held, and `groupBy` failed for a metric over any collection but tasks and events. Now it counts every matching record, windows events by their `time`, and pairs a duration's events by `subject` unless `pairBy` names another field. (#470)
- Before, a nested list ignored its `x-sortable`, a nested create was validated with its parent ids already in the body so a create schema allowing no extra fields refused it, and a JSON Logic binding searched only the first 25 records. Now a nested list is ordered as declared, the body is validated as sent, and a binding searches every record. (#470)
- Before, a nested list such as `/applications/{applicationId}/members` ignored `q` and returned every record under its parent. Now it searches with `q` the same way a top-level list does.
- Before, a contract declaring a path the mock serves itself, such as `/health` or `/mock/stubs/http`, was never reached. Now the mock refuses to start and names the route. (#283)
- Before, stubs registered on one mock server were still in place on the next one created in the same process. Now each server starts with none. (#470)
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
