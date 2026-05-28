# Changelog

All notable changes to `@codeforamerica/safety-net-blueprint-contracts` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] - 2026-03-17

### Added

- Cross-resource search API spec (`search-openapi.yaml`) with `GET /search` endpoint, uniform result shape, typed attributes, and extensible facets
- Rule evaluation engine with assignment and priority rule sets (`workflow-rules.yaml`, `rules-engine.js`)
- `evaluate-rules` effect type in state machine schema and engine
- Queue resource endpoints and examples in workflow API spec
- `onCreate` effects in create handler (audit events + rule evaluation)
- Shared pagination component (`components/pagination.yaml`) with `Pagination` schema
- Search as cross-cutting domain in `api-patterns.yaml`
- Search architecture documentation

### Changed

- Refactored 9 list schemas to compose `Pagination` via `allOf` with `unevaluatedProperties`
- Updated pattern validator to traverse `allOf` branches when checking list responses
- Refined search result attributes: added required `field` key, made `label` optional, simplified type enum to `string`, `date`, `currency`, made `facets` optional

### Fixed

- Postman generator now matches examples to endpoints by resource type instead of applying all examples to every endpoint in multi-resource APIs
- Fixed false 404s for secondary endpoints (e.g., `/task-audit-events`, `/token/claims`) that don't share seeded example data

## [1.1.0] - 2026-03-03

### Added

- State machine engine with transitions, guards, and set effects (`workflow-state-machine.yaml`)
- State machine loader, transition handler, and RPC overlay generator
- Create effects and audit events in state machine engine (`$now`, `$object.*` expressions, `TaskAuditEvent` schema)
- Behavioral contract JSON Schema format and validation (state machine, rules, metrics)
- Workflow task lifecycle behavioral contracts (3 states, 3 transitions, guards, effects, SLA, audit)
- Bidirectional YAML-CSV conversion scripts for behavioral contracts
- Appointment REST API and scheduling domain (`scheduling-openapi.yaml`)
- Case Management REST API (`case-management-openapi.yaml`)
- `api:update` script to add entities to existing domain specs
- `--bundle` flag for overlay resolution (dereferences all external `$ref`s)
- Unit tests for `generate-api.js` and `bundle.js`

### Changed

- Renamed CLI flags for consistency: `--specs` to `--spec`, `--base` to `--spec`, `--overlays` to `--overlay`
- Renamed `resolve-overlay` to `resolve` (script, command, test, bin entry)
- Improved CLI scripts: fixed flag forwarding, added `--out` flag, positional args support

### Removed

- Over-scoped behavioral contract YAMLs and CSV tables (replaced by simpler state machine in chunk 1)

### Fixed

- Windows glob expansion and duplicate workspace issues in test scripts
- `copyBaseSpecs()` now skips `package.json` and `node_modules`

## [1.0.0] - 2026-01-15

### Added

- Initial release of OpenAPI contract specs: Persons, Applications, Households
- OpenAPI Overlay Specification 1.0.0 support with smart scoping (two-pass processing)
- Overlay resolver with `update`, `rename`, and `replace` actions
- Spec validation (syntax, patterns, schemas) with Spectral linting
- Task REST API for workflow domain
- Reusable component schemas, parameters, and responses
- API design patterns (`api-patterns.yaml`)
- State overlay system (`overlays/{state}/modifications.yaml`)
- Design reference HTML generation
- Preflight quality gate script
- npm workspace packaging and publishing infrastructure
