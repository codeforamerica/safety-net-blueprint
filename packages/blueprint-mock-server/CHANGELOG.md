# Changelog

## 0.3.0

### Minor Changes

- d715967: Before, `blueprint-mock` could only start from a contracts directory. Now `--spec=contracts.json` starts it from a bundled artifact, and seeding, reseed and mock-data validation all read from that file. (#448) Mock-data validation no longer requires an `x-derived` field of a seed record: the seed is what is stored, a derived field is computed at read time, so requiring it failed every record in a set that declared one. (#460)
- 3e2a2ba: **Breaking:** before, uploading a document wrote its bytes to disk and `GET /document-versions/{id}/content` returned them. Now nothing is written and that endpoint returns a JSON object describing the file — name, type, size, hash, upload time — so a `snapshot()` can never carry real uploaded content. (#448)
- 3e2a2ba: Before, reaching mock behavior meant starting a server and sending it an HTTP request. Now every endpoint is a `(Request) => Response` function in a route table — exported from `./routes`, returned by `startMockServer`, and wrapped as a single `fetch` by `createMockServer({ contracts })` on the new `./browser` export, which runs the whole mock in a page, with `basePath` for one served from a subdirectory. Because that is `fetch`'s own signature, pointing one endpoint at a real service is `routes.get('POST /x').handler = fetch`. (#448)
- 27eda23: Before, a spec with a `$ref` naming something outside the contract set stopped the server from starting. Now it starts, and warns that no validator could be compiled for that schema — so requests to the affected endpoint are accepted unchecked. `blueprint-validate` reports the bad ref instead. (#448)
- 3e2a2ba: Before, installing the package brought in Express, `cors` and `multer`. Now the server runs on `node:http` and those are gone, with `express` remaining only for the optional `blueprint-swagger` bin. (#448)
- 912c3f0: Before, running the mock server meant SQLite on disk and a native module. Now `--store=memory` keeps resources in memory with neither, and `createMemoryStore` is available on its own from the new `./store` export; SQLite stays the default. (#448)
- 3e2a2ba: **Breaking:** before, `blueprint-mock --uploads=<dir>` and `MOCK_UPLOADS_DIR` chose where uploaded files were written. Now no files are written: both are gone, and `startMockServer(specDirs, seedDir, storeKind)` drops the `uploadsDir` parameter that was third of four. (#448)

### Patch Changes

- 7164d54: Before, declaring `parentLink: true` on a composition silently turned off expand, links-only and derived fields for that resource's `GET` — the handler returned the record with `_links` before any of them ran. Now the links are merged into the transformed response. (#448)
- e3d9062: Before, creating a resource under a spec that declares no localhost server URL emitted an event typed `".application.created"` — a leading dot and no domain, which nothing could subscribe to. Now the domain segment is omitted. (#448)
- 86e9c50: Before, a contract set with a metric counting anything other than `tasks` or `events` got a 500 from the metrics endpoint. Now the collections come from the metric definitions, so counting applications or determinations works. (#448)
- 185fd8e: Before, a state machine subscription whose steps emit an event never produced it — the emit threw internally, the error was caught and logged, and the transition that triggered the subscription still succeeded, so the event was simply missing. Now it reaches the event log. (#448)
- d0e30fe: Before, starting a second mock server in one process left the first one's event subscriptions attached, so every event was handled twice — a test suite had to clear listeners between runs to get a single result. Now registering subscriptions replaces the previous handler. (#448)
- Updated dependencies [fe0c210]
- Updated dependencies [62cb9e6]
- Updated dependencies [fe0c210]
- Updated dependencies [57981c8]
- Updated dependencies [fe0c210]
- Updated dependencies [fe0c210]
- Updated dependencies [869d7d5]
- Updated dependencies [7164d54]
- Updated dependencies [c268256]
  - @codeforamerica/blueprint-core@0.3.0

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
- d1a80d3: The mock server now serves a POST endpoint for every ruleset that declares
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
