# Changelog

## 0.2.0

### Minor Changes

- **Breaking:** An overlay that targeted `$.queues[...]`, `$.services[...]` or `$.document-types[...]` in a safety-net config file now targets `.entries[...]` under it. (#470)
- **Breaking:** `x-data-classification` on `DocumentVersion.uploadedById` and `DocumentLink.linkedBy` is now the list `[pii]` the convention defines, not the single value `pii`; read it as a list.
- **Breaking:** Events are named for the resource that sends them, with hyphenated domains as declared: for example `eligibility.decision.completed` where it was `eligibility.application.decision_completed`, and `data-exchange.call.completed` where it was `data_exchange.call.completed`. (#470)
- **Breaking:** The intake and workflow AsyncAPI documents are gone, and the others hold only events sent from outside the contracts; every other event is in the `*-events-asyncapi.yaml` that resolve generates beside each API. (#470)
- **Breaking:** The event log's API (`/platform/events`, its stream, single events and publishing) now comes with the framework in every resolved contract set, and `safety-net-contracts` no longer declares its own. A contract set that declares `/platform/events` itself must remove it. (#470)
- **Breaking:** Every registry type a contract set declares is now served at `/platform/registry/{type}` and `/platform/registry/{type}/{entryId}`, with `/platform/registry` listing the types, read from the registry files themselves — files of a type combine, and an entry id two of them define fails, naming both. `safety-net-contracts` no longer declares `/registry/policies`, which the generic endpoint serves at the same URL. (#470)

### Patch Changes

- `GET /eligibility/determinations/{determinationId}/decisions` now takes `q`, like every other list.
- Every document in the contracts now declares its domain: `info.x-domain` on OpenAPI and AsyncAPI documents, and a top-level `domain` elsewhere, mock data included. (#470)
- Before, the document upload's `documentTypeId` and `BackendAuthContext.userId` didn't say what they point at. Now they declare `x-relationship` to `DocumentType` and `User`. (#481)
- Before, fields that may be null were marked `nullable: true`, which validators implementing OpenAPI 3.1 ignore, so they refused the null. Now those fields are typed `[<type>, "null"]`. (#461)
- The contracts' conditions are now written as CEL with no dialect — names without `$`, `has()` for fields that may be absent — so any CEL implementation evaluates them the way the mock server does. (#445)
- Before, the workflow metrics other than `tasks_in_queue` could never count anything: they named event types no event has, paired by a `resourceId` events do not carry, and matched SLA status with a path wildcard JSON Logic does not support. Now they name the `workflow.task.*` event types, pair by `subject`, and match SLA status with `some`. (#470)
- Each package now declares its license, `PolyForm-Noncommercial-1.0.0`, so npm and dependency scanners show it. The terms are unchanged. (#452)
- Uses @codeforamerica/blueprint-mock-server 0.4.0.

## 0.1.2

### Patch Changes

- Before, validating or resolving the contract set reported references that named nothing in it: AsyncAPI documents pointing at a `schemas/events.yaml` that is not the canonical base events schema, and `x-relationship.resource` values naming a `domain/collection` path where a schema name belongs. Now every reference resolves. `EmployerInfo` is gone from `common/components/common.yaml` — it referenced a schema deleted in July, so it could not resolve either; use `Organization`, which carries the same fields. (#447)
- Uses @codeforamerica/blueprint-mock-server 0.3.0.

## 0.1.1

### Patch Changes

- **Deprecated:** The `policies-schema.yaml` registry format (`policies:` map) is
  superseded by `registry-schema.yaml` (`type: policies`, `entries:` map). Named
  registry files (`*-registry-{type}.yaml`) are discovered automatically. Both
  formats are supported; the old one will be removed in a future minor version.

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
