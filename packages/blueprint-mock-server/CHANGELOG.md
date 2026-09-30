# Changelog

## 0.2.0

### Minor Changes

- a89ec45: **Breaking:** `blueprint-core` is now imported from one entry point instead of
  seventeen subpaths, and every subpath import must be rewritten.
  
  The package exported 17 subpaths. It now exports one, `.`, carrying eight
  names — six pipeline stages and the two directories the package ships:
  
  ```js
  discover(dir, type?)        find contract files, with their type and domain
  load(file)                  parse one into a Doc
  generate(docs, type, opts?) derive 'overlay' | 'graph' | 'postman' | 'examples'
  extract(docs, type, opts?)  read out a stated fact: 'relationships'
  resolve(docs, { overlays, envTarget, envVariables })
  validate(docs)
  schemasDir, baseContractsDir
  ```
  
  `generate` makes what did not exist; `extract` surfaces what the documents
  already state. Both dispatch on a type string, as `discover(dir, type)` does.
  
  These subpaths no longer resolve: `@codeforamerica/blueprint-core/openapi`, `/rules`, `/validator`,
  `/overlay`, `/relationships`, `/compositions`, `/state-machines`,
  `/json-schema`, `/registries` and `/annotations` no longer resolve.
  
  `load` takes what `discover` returned rather than its parts:
  
  ```js
  - discover(dir).map((f) => load(f.path, f.relativePath))
  + discover(dir).map(load)
  ```
  
  `DiscoveredFile` and `Doc` both gain `domain`, derived from `info.x-domain`,
  then a top-level `domain`, then a path segment or filename prefix naming a
  value in the `Domain` enum. The last two need the whole set, which is why
  `discover` resolves it.
  
  `Doc.refs` and `Doc.model` are now methods. As fields they were computed once
  at load and went stale the moment a resolve pass rewrote `content`, which had
  `validate` checking pre-resolution documents. `refs()` entries also carry
  `name`, the schema name a reference points at, which replaces the former
  `extractRefName` export.
  
  **Moved out of core, to the package that wanted them:**
  
  | what | where |
  |---|---|
  | OpenAPI spec loading and the server's runtime view of a spec | blueprint-mock-server |
  | OpenAPI structural validation, example-data validation | blueprint-mock-server |
  | annotation merging, contract navigation for docs generation | blueprint-explorer |
  | `bundleSpec` | blueprint-cli |
  
  **blueprint-rules-engine no longer depends on blueprint-core.** `toGraph`,
  `toGraphWithFactGraph` and `toFactGraphXml` take a compiled graph; they no
  longer accept a rules contract and compile it. Compile with
  `generate(docs, 'graph')` and pass the graph. The browser bundle drops the
  stub that existed only to keep core out of it.
  
  Also fixed along the way:
  
  - `$ref` following was bounded by `process.cwd()`, so resolving the same
    contracts from a workspace directory silently dropped every cross-file ref
    and reported hundreds of fields as missing. It is bounded by the contract
    set now.
  - `discover` skips deprecated documents, which every caller was doing
    immediately afterwards anyway.
  - Resolve separates writing from succeeding: schema conformance still blocks
    the write, because it can only run before refs are rewritten, but every
    other failure writes the artifacts, reports, and exits non-zero.
  - State machine step walking had drifted into three copies of the same
    accessors. `Doc.model()` normalizes the authored shape — `then`/`else` on
    if, `when` on match, `do` on forEach — into uniform `{ kind, ...fields,
    children }` nodes, and the copies are gone. This fixed a silent defect: the
    old helper looked for a `forEach` body under `forEach.do` rather than the
    sibling `do`, so every loop body rendered empty in the generated state
    machine documentation.
- d1a80d3: The mock server now automatically serves rules evaluation endpoints. Rulesets that declare an `endpoint:` in their `*-rules.yaml` file get a live POST endpoint at startup — no additional wiring required. Partial evaluation is supported: submit whatever inputs are available and the response includes resolved facts, placeholder values, and the specific input paths still needed to resolve pending outputs.

### Patch Changes

- Updated dependencies [15e4b60]
- Updated dependencies [a89ec45]
- Updated dependencies [15e4b60]
- Updated dependencies [d1a80d3]
  - @codeforamerica/blueprint-core@0.2.0

All notable changes to `@codeforamerica/safety-net-blueprint-mock-server` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
