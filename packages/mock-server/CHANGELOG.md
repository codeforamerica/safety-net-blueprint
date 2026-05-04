# Changelog

All notable changes to `@codeforamerica/safety-net-blueprint-mock-server` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0] - 2026-05-04

### Added

- **`emit-event.js`**: shared CloudEvents 1.0 envelope construction utility. Persists to the events collection, broadcasts via SSE event bus, propagates `traceparent` from request headers, and derives event types as `org.codeforamerica.safety-net-blueprint.{domain}.{object}.{action}`
- **CRUD lifecycle event auto-emit**: every POST emits `{object}.created` (full resource snapshot), every PATCH emits `{object}.updated` (field-level diff with `before`/`after`), every DELETE emits `{object}.deleted`
- **`emitEventEnvelope()`** for injecting pre-built CloudEvents envelopes (used by `POST /platform/events` for integration testing)
- **`POST /platform/events`** endpoint: accepts a CloudEvents 1.0 envelope and fires it to the event bus, enabling integration tests to simulate events from external domains
- **Event subscription engine** (`event-subscription.js`): listens on the event bus, matches rule sets by `on:` field (full or short-form CloudEvents type), resolves context bindings with the event envelope as `this`, evaluates rules, and dispatches actions
- **`state-machine-runner.js`**: extracted core transition logic from the HTTP handler so programmatic callers (event-triggered transitions, `triggerTransition` action) share the same machinery
- **`platform-action-handlers.js`**: generic platform actions available to all domains — `createResource` (with JSON Logic field resolution and full onCreate pipeline), `triggerTransition` (system-identity transitions on related entities), `forEach` (per-collection-item iteration), `appendToArray` (append values to array fields)
- **`workflow-action-handlers.js`**: domain-specific actions extracted from the merged registry — `assignToQueue`, `setPriority`
- **`evaluateAllMatchRuleSet`**: collects all matching rules instead of stopping at first match; dispatched by `processRuleEvaluations` and event subscriptions when `ruleSet.evaluation === 'all-match'`
- **Context enrichment in rule evaluation**: `resolveContextEntities` fetches related entities by ID from the DB before rule evaluation; supports JSON Logic `{var: "..."}` form for `from:`, collection bindings (no entity lookup), `optional: true` for non-required bindings, and chaining (each binding can reference previously resolved entities)
- **Sub-resource route generation**: collection sub-resources (`/parents/{id}/children`) and singleton sub-resources (`/parents/{id}/child`) classified and routed correctly; parent existence enforced (404 on missing parent); singleton GET/PATCH look up by parent field
- **`collection-utils.js`**: shared `deriveCollectionName` utility (extracted to break a circular dependency); handles parent-singular prefixing for sub-collections (`application-documents`) and pluralization for singletons (`interviews`)
- **Multi-state-machine domain support**: a single domain can register multiple state machines (e.g., `Application` and `ApplicationDocument` both under `intake`); state machines are matched per collection via kebab-plural comparison
- **Config-managed resources**: `config-loader.js` discovers `*-config.yaml` files and seeds entries with `source: system`; `config-registry.js` tracks config-managed IDs in memory; DELETE returns 409 `CONFIG_MANAGED` for those IDs; POST sets `source: user` on runtime-created resources in collections that have config entries
- **`json_tree()`-based nested field search**: `search` parameter and full-text query tokens now match values at any nesting depth (e.g., `name.firstName`), replacing the per-field LIKE approach
- **SLA engine resolved entities**: `initializeSlaInfo` and `updateSlaInfo` accept a `resolvedEntities` map so SLA conditions can reference fields on related entities

### Changed

- **All domain events now use the CloudEvents 1.0 envelope**. The legacy custom envelope (`domain`, `resource`, `action`, `resourceId`, `occurredAt`) is replaced by `specversion`, `type`, `source`, `subject`, `time`. Event filters now use `?subject=` (was `?q=resourceId:`); event consumers should read `e.type.endsWith('.created')` (was `e.action === 'created'`), `e.subject` (was `e.resourceId`), `e.time` (was `e.occurredAt`)
- **Transition handler**: now a thin HTTP adapter delegating to `state-machine-runner.executeTransition`
- **`action-handlers.js`**: split into `platform-action-handlers.js` and `workflow-action-handlers.js`; the file now merges both registries
- **Integration test assertions**: updated to CloudEvents fields (`type`, `subject`, `time`, `specversion`)

### Fixed

- **Initial state not applied on resource create**: resources created with a state machine were getting `status: null`. The create handler now reads `initialState` from the state machine and persists it on creation
- **Rule evaluation results not persisting on task create**: the before-snapshot was captured after rule evaluation mutated the resource; capturing it before fixes the diff so rule-driven fields (`priority`, `queueId`) are written back to the DB
- **`POST /platform/events`** with missing required CloudEvents fields now returns 422 `VALIDATION_ERROR` (was 400)
- **Postman generator**: sub-collection POSTs are no longer misclassified as state machine RPC transitions
- **`resolve.js` and `generate-clients-typescript.js`**: skip deprecated specs (`x-status: deprecated`) before parsing

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
