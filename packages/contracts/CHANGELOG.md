# Changelog

All notable changes to `@codeforamerica/safety-net-blueprint-contracts` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0] - 2026-05-04

### Added

- **Intake domain** (`intake-openapi.yaml`, `intake-state-machine.yaml`, `intake-rules.yaml`): Application lifecycle (draft → submitted → under_review → withdrawn/closed), `complete-review` trigger emitting `application.review_completed`, sub-resource paths for `ApplicationDocument` (`/applications/{id}/documents`) and `Interview` (`/applications/{id}/interview`), and `intake-application-document-state-machine.yaml` (requested → verified)
- **CloudEvents 1.0 envelope** for all domain events: `specversion`, `type`, `source`, `subject`, `time`, `datacontenttype`. Type derivation: `org.codeforamerica.safety-net-blueprint.{domain}.{object}.{action}`
- **CloudEvents Auth Context extension**: `authid` and `authtype` envelope attributes for event actor provenance (required for FTI-governed events per IRS Pub. 1075)
- **Distributed tracing contract**: `traceparent` propagation from inbound requests to all emitted events; documented in `inter-domain-communication.md` and `api-patterns.yaml`
- **Cross-domain event wiring**: `on:` field on rule sets makes them event-triggered; new platform action types `createResource` and `triggerTransition` defined as named `$defs` in `rules-schema.yaml`
- **Rules engine extensions**: `all-match` evaluation alongside `first-match-wins`; `forEach` action with `in`/`as`/`filter` for per-collection-item iteration; `appendToArray` action; collection context bindings; JSON Logic `{var: "..."}` form for context binding `from:` paths
- **Context enrichment for rules**: per-ruleSet context bindings with `domain/resource` entity format, `this` alias for the calling resource, multi-hop chaining via `from`, `optional: true` flag for non-required bindings
- **`workflow-config.yaml`**: queue catalog (`snap-intake`, `general-intake`) with stable UUIDs, schema-validated via `workflow-config-schema.yaml` extending generic `schemas/config-schema.yaml`. Config-managed resources get `source: system` and reject DELETE with 409 `CONFIG_MANAGED`
- **Generic platform actions documented**: `ActionCreateResource`, `ActionTriggerTransition`, `ActionForEach`, `ActionAppendToArray` as reusable `$defs`
- **`taskType` field** on Task schema (open string, used for routing rules and lifecycle branches)
- **`evidence` array** on `ApplicationDocument` (populated when `document-management.document.verified` fires)
- **`x-data-classification`** convention for marking PII/FTI/PHI fields
- **`x-environments`** extension for filtering specs by deployment environment
- **`x-domain`, `x-status`, `x-visibility`** required info-block fields documented in `required_info_fields` pattern
- **`enum_extensibility` pattern**: domain values use enums with overlay extension, not open strings
- **Sub-resource path patterns** in `api-patterns.yaml`: collection (`/parents/{id}/children`) and singleton (`/parents/{id}/child`) conventions
- **`validate-rules.js`**: static cross-reference validator checking entity paths against discoverable API resources and `from` fields against calling-resource schemas; added to `npm run validate`
- **Data Exchange domain design** (`docs/architecture/domains/data-exchange.md`): facade pattern, ExternalService catalog + ExternalServiceCall lifecycle, 13 design decisions; external service reference docs for IRS, SSA, USCIS SAVE, CMS FDSH, state wage records
- **Identity & Access architecture record** (`docs/architecture/cross-cutting/identity-access.md`): three-layer auth model (IdP → User Service → Domain APIs), OAuth scope granularity, service-to-service auth, API security declarations
- **`api:new` `--domain` flag** (defaults to `--name`) and required info-field scaffolding

### Changed

- **`api-patterns.yaml`**: added `auto_emit`, `traceparent`, `x_data_classification`, `enum_extensibility`, `required_info_fields`, `cloudevents_envelope`, `x_extensions` catalog, sub-resource path patterns, `config_managed_resources`
- **Workflow state machine**: removed `type: event, action: created` from `onCreate` (now auto-emitted by create handler); added `data.assignedToId` to claim event
- **`TaskCreatedEvent`**: now `$ref` Task schema (full snapshot in event payload)
- **`TaskClaimedEvent`**: gained required `assignedToId` field
- **Components events.yaml**: `DomainEvent` replaced with `FieldChange`, `ResourceUpdatedEvent`, `ResourceDeletedEvent` shared schemas (used by all domains)
- **Workflow rules**: SNAP-only routing now requires `programs.length === 1` (multi-program apps fall through to general-intake)
- **Rules schema**: `ruleType` is optional on event-triggered rule sets; `entity` is optional on context bindings (collection bindings); usage-example comment blocks before each `$def`
- **Documentation reorganization**: `state-overlays.md` → `overlay-guide.md`, `state-setup-guide.md` → `setup-guide.md`; `creating-apis.md` rewritten and trimmed (-409 lines); resolver pipeline doc gains stages 5 (`x-environments` filtering) and 6 (placeholder substitution)

### Removed

- **`x-api-type`** extension (superseded by contract-driven architecture); removed from `applications`, `households`, `incomes`, `persons`, `users` specs
- **`applications-openapi.yaml`** marked `x-status: deprecated`; excluded from mock, validator, and pattern checks (replaced by intake-openapi.yaml)
- **`onCreate` event effect** from workflow state machine (events now auto-emitted from create handler)

### Fixed

- **Rule evaluation results not persisting on task create**: before-snapshot was captured after `processRuleEvaluations` mutated the resource, making the diff always empty; rule-driven fields (`priority`, `queueId`) are now persisted correctly
- **`resolve.js`**: skips deprecated specs (`x-status: deprecated`) before parsing; type-guards `x-enum-source` to handle non-string values without crashing
- **`export-contract-tables.js`**: handles JSON Logic `in` operator with `{var: "..."}` second argument (was crashing on `.map is not a function`)

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
