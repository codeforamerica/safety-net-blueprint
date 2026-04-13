# Data Exchange Domain: Design Reference

The Data Exchange domain defines the contract surface for all interactions between the blueprint and external agencies and data sources — IRS, SSA, USCIS SAVE, state wage databases, and others. This document covers the process, entity model, call lifecycle, domain events, and the design decisions that shape the domain. Vendor comparisons draw on IBM Cúram, ServiceNow, Salesforce Government Cloud, and the MITA 3.0 framework. Regulatory context references 7 CFR § 272.8 and 42 CFR § 435.940–965.

## Overview

The Data Exchange domain acts as a facade for all external service interactions. Calling domains (Eligibility, Workflow, Client Management) initiate requests — directly via Data Exchange endpoints or via rules in their own domain that trigger a submission when a relevant event occurs. Data Exchange executes the call, tracks the lifecycle, and emits result events that calling domains subscribe to in order to resume. It owns the catalog of available external services and the lifecycle of every external call made. It does not own the policy decisions that determine whether external data is needed, when to request it, or what to do with the result — those stay in the calling domain.

## What happens during a data exchange request

1. A caseworker or automated process determines that external data is needed — to verify income, confirm identity, check immigration status, or confirm no duplicate enrollment exists across programs or states. (7 CFR § 272.8, 42 CFR § 435.940)
2. The requesting process submits a call to the Data Exchange domain, identifying the service and providing the required input data. Automated flows may trigger this submission based on prior events without direct caseworker action.
3. For synchronous requests, the Data Exchange domain calls the external source and returns the result before the requesting process continues.
4. For asynchronous requests, the Data Exchange domain acknowledges the submission and the calling process enters a waiting state. The call is routed to the external source.
5. When the external source responds, the call resolves and a result event is emitted. The calling process resumes based on the result.
6. Every call transition emits a domain event conforming to the platform CloudEvents format. These events constitute the immutable audit record required for federal data matching compliance. (7 CFR § 272.8(d), 42 CFR § 435.945)

## Regulatory requirements

### Federal data exchange mandates

| Program | Requirement | Citation | Notes |
|---|---|---|---|
| SNAP | Income and Eligibility Verification System (IEVS) — agencies must query SSA, IRS, and state wage records | 7 CFR § 272.8 | Required quarterly for active cases |
| Medicaid | Electronic verification of income, citizenship, and immigration status | 42 CFR § 435.940–965 | MAGI Medicaid requires real-time hub queries |
| All programs | Computer Matching and Privacy Protection Act — data matching requires formal agreements | 5 U.S.C. § 552a | Agreement management is an operational state responsibility; out of scope for the blueprint contract layer |

### Standard data exchange sources

IRS (income), SSA (income, disability, identity), USCIS SAVE (immigration status), state wage record databases, state new hire registries, and inter-state enrollment hubs (for duplicate benefit checks).

## Entity model

### ExternalService

The catalog of available external data sources. Each entry describes a type of external service the agency can call. Entries are defined at deployment time in `data-exchange-config.yaml` — not created via API at runtime. The blueprint defines entries for known federal services (IRS, SSA, USCIS SAVE, state wage databases); states overlay those entries with their endpoint configuration and add any state-specific services following the same schema.

Key fields:
- `id` — unique identifier
- `name` — human-readable name (e.g., "SSA Death Master File")
- `serviceType` — category: `income_verification`, `identity_verification`, `immigration_status`, `enrollment_check`, `eligibility_hub`, `incarceration_check`
- `defaultCallMode` — `sync` or `async`
- `programs` — which programs use this service (`snap`, `medicaid`, `tanf`, or `all`)

### ExternalServiceCall

The runtime resource tracking a single external service call from submission through resolution. Governs the call lifecycle and serves as the correlation handle adapters use when calling back with a result.

Key fields:
- `id`, `createdAt`, `updatedAt` — standard resource fields; `createdAt` is when the call was submitted, `updatedAt` when status last changed
- `serviceId` — which ExternalService was called
- `callMode` — `sync` or `async` for this specific call
- `status` — current state in the call lifecycle
- `requestingResourceId` — the resource that triggered the call (task ID, determination ID, etc.); combined with `serviceId`, serves as the idempotency key (see [Decision 8](#decision-8-idempotency-via-requestingresourceid--serviceid))

All other call metadata — requesting domain, timestamps of individual transitions, result payload — is captured in the CloudEvents emitted on each lifecycle transition. The trace context propagated in CloudEvent headers links the call back to the originating request.

## ExternalServiceCall lifecycle

### States

| State | Description | SLA clock |
|---|---|---|
| `pending` | Call submitted, awaiting external source response | running |
| `completed` | External source responded successfully | stopped |
| `failed` | External source returned an error or rejection | stopped |
| `timed_out` | No response received within the configured window | stopped |

### Key transitions

- **submit → pending** — call is submitted to the external source (async mode)
- **complete → completed** — external source responded successfully
- **fail → failed** — external source returned an error
- **timeout → timed_out** — response window elapsed without a result

For sync calls, the call record moves directly to `completed` or `failed` within the same request — it does not sit in `pending`.

## Domain events

### Event types

Data Exchange emits lifecycle events on ExternalServiceCall transitions. Calling domains subscribe to result events to resume their waiting state machine transitions.

### Event catalog

| Event | Why it's needed | Trigger | Primary consumers |
|---|---|---|---|
| `data_exchange.call.submitted` | Calling domain needs confirmation the call is in flight before entering a waiting state | submit transition | Workflow, Eligibility |
| `data_exchange.call.completed` | Calling domain must resume its lifecycle when a result arrives | complete transition | Workflow, Eligibility, Client Management |
| `data_exchange.call.failed` | Calling domain must handle failure — create a follow-up task, notify, or proceed without the data | fail transition | Workflow, Eligibility |
| `data_exchange.call.timed_out` | Timeout must be treated differently from failure — may warrant retry or escalation | timeout transition | Workflow, Eligibility |

## Key design decisions

| # | Decision | Summary |
|---|---|---|
| 1 | [Facade pattern](#decision-1-facade-pattern) | Other domains call Data Exchange; Data Exchange calls external services |
| 2 | [Sync and async both supported](#decision-2-sync-and-async-call-modes) | Call mode is per-call; the domain handles both |
| 3 | [External service catalog as domain-level config](#decision-3-external-service-catalog-as-domain-level-config) | Blueprint defines federal service entries and schema in `data-exchange-config.yaml`; states overlay with their endpoint config and add state-specific services |
| 4 | [VerificationSource superseded](#decision-4-verificationsource-superseded) | Workflow's planned VerificationSource is replaced by ExternalService/ExternalServiceCall |
| 5 | [Events as audit trail; ExternalServiceCall for lifecycle](#decision-5-events-as-audit-trail-externalservicecall-for-lifecycle) | CloudEvents log is the immutable audit record; ExternalServiceCall governs the call lifecycle and serves as the correlation handle |
| 6 | [Calling domains own subscription logic](#decision-6-calling-domains-own-subscription-logic) | The rules that determine when to call an external service live in the calling domain, not in Data Exchange |
| 7 | [Result payload schemas per service type](#decision-7-result-payload-schemas-per-service-type) | Each service type defines its own result schema; composite service types reuse component schemas |
| 8 | [Idempotency via requestingResourceId + serviceId](#decision-8-idempotency-via-requestingresourceid--serviceid) | Duplicate submissions are detected by checking for an existing pending call on the same resource and service |
| 9 | [Credentials not in config](#decision-9-credentials-not-in-config) | `data-exchange-config.yaml` holds connection parameters only; credentials are injected at deploy time |
| 10 | [Failure classification via failureReason](#decision-10-failure-classification-via-failurereason) | `call.failed` event carries a `failureReason` field so calling domains can distinguish retriable from non-retriable failures |
| 11 | [Partial results for composite calls](#decision-11-partial-results-for-composite-calls) | Composite calls resolve to `completed` with `matchStatus: partial`; consumers evaluate sufficiency |
| 12 | [Event delivery and audit separation](#decision-12-event-delivery-and-audit-separation) | `/events` delivers results to subscribers; event store is the audit record; `/audit` endpoint deferred |

---

### Decision 1: Facade pattern

**What's being decided:** Whether other domains call external services directly, or through a dedicated Data Exchange domain.

**Considerations:**
- IBM Cúram has a dedicated "Data Hub" that mediates all external data requests — program domains call the hub, not external systems directly.
- ServiceNow's Integration Hub is a distinct domain with its own API surface; workflows call Integration Hub actions.
- MITA 3.0 defines "Data Exchange" as a separate business area from Eligibility and Case Management — a recognized separation in the IEE space.
- Salesforce Government Cloud uses Integration Procedures as a centralized orchestration layer for external calls.
- Direct calls from each domain would scatter external service credentials, retry logic, and call history across every domain, with no portable contract surface for states to develop against or mock.

**Options:**
- **(A)** Direct — each domain calls external services itself, with its own adapter and call history
- **(B) ✓** Facade — Data Exchange mediates all calls; domains call Data Exchange endpoints; states implement adapters behind those endpoints

**Customization:** States implement adapters that back the Data Exchange endpoints with their specific service configurations. The contract surface (endpoints, schemas, events) is defined by the blueprint.

---

### Decision 2: Sync and async call modes

**What's being decided:** Whether to support synchronous calls (blocking, result returned inline), asynchronous calls (event-driven, calling domain waits in a state), or both.

**Considerations:**
- Real-time identity verification during intake submission needs a result before the application can proceed — sync.
- Income verification via IEVS is batch-oriented and may take hours — async.
- Cúram and ServiceNow both support synchronous and asynchronous integration modes.
- Restricting to async-only would require real-time hub queries (MAGI Medicaid eligibility, duplicate enrollment checks) to enter a waiting state for queries that typically respond in milliseconds.

**Options:**
- **(A)** Async only — all calls go through the event-driven waiting state pattern
- **(B)** Sync only — all calls block within the transition
- **(C) ✓** Both — `callMode` is specified per call; the domain handles both paths

**Customization:** States can set a different default `callMode` for a given ExternalService entry via overlay on `data-exchange-config.yaml`.

---

### Decision 3: External service catalog as domain-level config

**What's being decided:** How the ExternalService catalog is defined, where it lives, and how states add their own entries.

**Considerations:**
- Specific external service endpoints and credentials are state-specific — they cannot be defined in the blueprint's OpenAPI spec without exposing production configuration or requiring states to put credentials in the spec.
- The schema for service entries (service type, call mode, program scope) is consistent across all states and can be defined at the blueprint level.
- Known federal services (IRS, SSA, USCIS SAVE, state wage databases) are used by every state — the blueprint can define these entries with placeholder endpoint config that states fill in via overlay, giving states a concrete model to follow when adding state-specific services.
- ServiceNow Integration Hub Spokes, Cúram's external interface definitions, and Salesforce Named Credentials are all defined as deployment-time configuration, not as runtime data created via API — the catalog pattern is consistent with how every major IEE vendor handles external service registration.
- Overlay actions target the OpenAPI spec via JSONPath — awkward for catalog entries that contain deployment-sensitive data and are not part of the API schema.
- The global config overlay (`config.yaml`) is for cross-cutting API style preferences (casing, pagination, relationship representation) — not a fit for a domain-specific service registry.

**Options:**
- **(A)** OpenAPI spec examples — catalog entries as example data in the OpenAPI spec; overlaid via JSONPath overlay actions. Conflates API schema with runtime configuration; exposes deployment-sensitive URLs in the spec.
- **(B)** Global config overlay — add a `services` section to `config.yaml`. Conflates cross-cutting API style preferences with domain-specific service registry data.
- **(C) ✓** Domain-level config file — `data-exchange-config.yaml` with JSON Schema validation; overlayable; follows the same artifact pattern as `data-exchange-rules.yaml` and `data-exchange-state-machine.yaml`.

**Customization:** States overlay `data-exchange-config.yaml` to add their endpoint configuration to the blueprint-defined federal service entries and to add any state-specific services. The blueprint-defined federal entries serve as both required configuration stubs and a schema model for state-specific additions.

---

### Decision 4: VerificationSource superseded

**What's being decided:** Whether Workflow's planned VerificationSource entity is still needed alongside the Data Exchange domain.

**Considerations:**
- VerificationSource was planned as a registry of external verification APIs within the Workflow domain.
- Data Exchange's ExternalService catalog fills exactly this role at the platform level rather than the workflow level.
- Maintaining both would create two registries of external services with overlapping purpose.

**Options:**
- **(A)** Keep VerificationSource in Workflow as a domain-specific reference
- **(B) ✓** Remove VerificationSource; Workflow's VerificationTask references ExternalServiceCall records from Data Exchange instead

---

### Decision 5: Events as audit trail; ExternalServiceCall for lifecycle

**What's being decided:** How to satisfy the federal audit trail requirement for data matching, and what role ExternalServiceCall plays.

**Considerations:**
- 7 CFR § 272.8(d) and 42 CFR § 435.945 require that all external data matching activity be retained for federal audit purposes.
- Issue #210 establishes CloudEvents as the platform event format — every state machine transition emits a CloudEvents-conformant event recorded by the event log.
- Domain events emitted on ExternalServiceCall transitions capture who called what service, when, and with what result — exactly the information federal audit requires.
- ExternalServiceCall also serves as the correlation handle: adapters call back to the ExternalServiceCall record when a result arrives, and the state machine governing it defines the SLA clock and timeout behavior.
- Treating ExternalServiceCall itself as the immutable audit record would duplicate information already captured in the event log and create an inconsistency — the event log is the audit record for all other domains.

**Options:**
- **(A)** ExternalServiceCall as immutable audit record — call records are the primary compliance artifact
- **(B) ✓** Events as audit trail — CloudEvents log provides the immutable audit record; ExternalServiceCall governs the call lifecycle and serves as the correlation handle for adapter callbacks

---

### Decision 6: Calling domains own subscription logic

**What's being decided:** Whether the rules mapping domain events to external service calls live in Data Exchange or in the calling domain.

**Considerations:**
- A rule such as "when a SNAP application is submitted, run an IEVS check" encodes program policy — knowledge that belongs in Eligibility, not in an integration layer.
- ServiceNow Integration Hub and Cúram Data Hub are pure service layers: the workflow or eligibility process that decides when to call them owns that logic; the hub only executes.
- If Data Exchange owned subscription rules, states would need to modify Data Exchange configuration to change when verifications are triggered, coupling program policy to the integration layer.
- Keeping subscription logic in calling domains means each domain's rules YAML is the complete description of that domain's behavior — including when it reaches out for external data.

**Options:**
- **(A)** Data Exchange owns subscription rules — `on:` triggers mapping domain events to service calls live in `data-exchange-rules.yaml`
- **(B) ✓** Calling domains own subscription rules — the `on:` triggers that initiate Data Exchange calls live in the calling domain's rules YAML; Data Exchange is a pure execution layer

**Customization:** States configure when external service calls are triggered by overlaying the relevant calling domain's rules YAML.

---

### Decision 7: Result payload schemas per service type

**What's being decided:** How the result payload of a completed external service call is structured and made extensible for states.

**Considerations:**
- Calling domains must be able to consume results without knowing which specific external service was called — the schema must be defined at the service type level, not per service ID.
- The service type reflects the external API call: one request, one service type, result schema matches what that API returns. Composite API responses (such as CMS FDSH, which returns income, citizenship, immigration, Medicare, and incarceration results in a single call) warrant their own service type rather than being broken into separate calls.
- States may receive additional fields from their specific external service endpoints that the blueprint schema does not capture — result schemas must be extensible.
- `expiresAt` is only meaningful when the external service itself returns a validity window; it should not be calculated by the blueprint.
- Composite service types should reuse component schemas from standalone service types via `$ref` rather than duplicating them — consistent with the blueprint's shared components pattern.

**Service types and result schemas:**

| Service type | External API | Result |
|---|---|---|
| `income_verification` | IRS, SSA, state wage records | Income sources, amounts, period, reporting source |
| `identity_verification` | SSA | Name, DOB, SSN match; deceased indicator |
| `immigration_status` | USCIS SAVE | Verified status, immigration category, SAVE verification number, as-of date |
| `enrollment_check` | Inter-state hub | Active enrollment found; enrollments by state, program, and period |
| `eligibility_hub` | CMS FDSH | Composite: income, citizenship, immigration, Medicare enrollment, incarceration — sub-results reuse standalone service type schemas via `$ref` |
| `incarceration_check` | SSA Prison Verification System | Incarcerated indicator |

**Options:**
- **(A)** Generic envelope — a single untyped result payload that adapters populate freely. Calling domains cannot rely on a consistent schema.
- **(B)** Per service ID — schemas defined for each specific external service entry. Too granular; couples calling domain logic to state-specific service configuration.
- **(C) ✓** Per service type — each service type defines a result schema in the OpenAPI spec; adapters produce results conforming to the schema for that type; states extend via overlay.

**Common envelope** (all service types):
- `matchStatus` — `matched`, `not_matched`, `partial`, `inconclusive`, `pending_manual_review`
- `expiresAt` — optional; populated only when the external service returns a validity window
- `data` — service-type-specific payload

**Customization:** States extend service type result schemas via overlay to capture additional fields returned by their specific external service endpoints.

---

### Decision 8: Idempotency via requestingResourceId + serviceId

**What's being decided:** How to prevent duplicate external service calls when a calling domain retries a submission — for example, after a network failure.

**Considerations:**
- A duplicate IEVS or SAVE query has real cost and compliance implications — external agencies may count queries against the agency's usage, and duplicate calls create redundant audit records.
- CloudEvent trace context handles correlation (linking a call back to its origin) but does not prevent a second submission from being treated as a new call.
- `requestingResourceId` combined with `serviceId` forms a natural semantic idempotency key: there should only ever be one active call for a given resource against a given service at a time.
- If a `pending` call already exists for the same `requestingResourceId` + `serviceId`, the duplicate submission can be detected at the Data Exchange contract layer before reaching the external service.

**Options:**
- **(A)** No deduplication at Data Exchange — calling domains are responsible for not submitting duplicates; adapters rely on external service idempotency
- **(B)** Caller-supplied idempotency key — calling domain passes an explicit key; Data Exchange deduplicates on it
- **(C) ✓** Semantic deduplication — Data Exchange checks for an existing `pending` call on the same `requestingResourceId` + `serviceId`; rejects or returns the existing call if found

---

### Decision 9: Credentials not in config

**What's being decided:** Where credentials for external services (API keys, certificates, OAuth tokens) live relative to `data-exchange-config.yaml`.

**Considerations:**
- Credentials in a config file would end up in version control, violating secrets management best practice.
- ServiceNow separates credential records from spoke definitions; Salesforce separates Named Credentials from integration configuration — the pattern is consistent across major vendors.
- `data-exchange-config.yaml` is an overlay point that states share and version; it is not a secrets store.

**Options:**
- **(A)** Credentials in `data-exchange-config.yaml` — simple but insecure; credentials in version control
- **(B) ✓** Config file holds connection parameters only (endpoint URL, timeout, service version); credentials are injected at deploy time via environment variables or a state-configured secrets manager; adapters retrieve them from the state's secrets infrastructure

---

### Decision 10: Failure classification via failureReason

**What's being decided:** Whether to distinguish between types of call failures so calling domains can react appropriately.

**Considerations:**
- `failed` as a single terminal state conflates connection errors (potentially retriable), service errors (potentially retriable), and authentication errors (not retriable without operational intervention).
- Calling domains need to know whether to retry, escalate, or proceed without the data — the appropriate response differs by failure type.
- `failureReason` in the event payload keeps the lifecycle simple (one `failed` state) while giving consumers the context they need.
- Putting `failureReason` on the ExternalServiceCall resource would conflict with the principle that events are the record of truth.

**Options:**
- **(A)** Single `failed` state with no sub-classification — calling domains treat all failures identically
- **(B)** `failureReason` on the ExternalServiceCall resource — queryable but duplicates what is in the event
- **(C) ✓** `failureReason` in the `call.failed` event payload only — values: `connection_error`, `service_error`, `authentication_error`; resource stays lean

---

### Decision 11: Partial results for composite calls

**What's being decided:** How `eligibility_hub` calls resolve when FDSH returns some sub-results but not others.

**Considerations:**
- FDSH can return partial results — if one upstream source (e.g., IRS) is unavailable, SAVE and SSA results may still be returned.
- Treating partial responses as `failed` discards useful data and forces the calling domain to retry the entire composite call.
- Adding a new `partial` lifecycle state complicates the state machine and every consumer that subscribes to result events.
- The calling domain is best positioned to decide whether the returned sub-results are sufficient to proceed with its determination.

**Options:**
- **(A)** `failed` — any missing sub-result fails the whole call; useful data discarded
- **(B)** New `partial` lifecycle state — adds complexity to the state machine and all consumers
- **(C) ✓** `completed` with `matchStatus: partial` — call resolves as completed; missing sub-results carry `matchStatus: inconclusive`; consumer evaluates sufficiency

---

### Decision 12: Event delivery and audit separation

**What's being decided:** How async results are delivered to calling domains, and how the audit record is maintained.

**Considerations:**
- For sync calls, the full result is returned in the HTTP response — no event subscription needed.
- For async and event-triggered calls, the `call.completed` event is the delivery mechanism — calling domains subscribe and receive the full result payload inline. Querying an event store to retrieve async results is inconsistent with event-driven architecture.
- The event store retains all events (including full result payloads) as the immutable audit record, consistent with the platform CloudEvents approach established in #210.
- A separate `/audit` endpoint is additive — the event store can feed an audit store via a projection without any breaking contract changes. Introducing it prematurely adds complexity before the access control and retention requirements are fully defined (#216).
- Result payloads contain PII. Data classification annotations on result schema fields (defined by #216) will govern what the event store exposes to each consumer class.

**Options:**
- **(A)** Separate result endpoint — calling domains fetch results from `GET /external-service-calls/{id}/result`; creates a second retrieval path alongside event delivery
- **(B)** Event store query — calling domains query `/events` for past results; inconsistent with event-driven subscription model
- **(C) ✓** Event delivery with deferred audit endpoint — `call.completed` event carries the full result payload; calling domains subscribe and receive results inline; event store is the audit record; `/audit` endpoint deferred until #216 defines access control and retention requirements

**Dependencies:** Data classification annotations on result schema fields → #216. Centralized event store access controls and retention policies → #216.

---

## References

- Regulatory: 7 CFR § 272.8, 42 CFR § 435.940–965, 5 U.S.C. § 552a
- Standards: MITA 3.0 Business Architecture, CloudEvents
- Related docs: [Domain Design Overview](../domain-design.md), [Contract-Driven Architecture](../contract-driven-architecture.md), [Workflow Domain](workflow.md)
