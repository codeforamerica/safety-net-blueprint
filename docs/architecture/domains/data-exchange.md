# Data Exchange Domain

The Data Exchange domain defines the contract surface for all interactions between the blueprint and external agencies and data sources — IRS, SSA, USCIS SAVE, state wage databases, and others. Vendor comparisons draw on IBM Cúram, ServiceNow, Salesforce Government Cloud, and the MITA 3.0 framework. Regulatory context references 7 CFR § 272.8 and 42 CFR § 435.940–965.

## Overview

The Data Exchange domain acts as a facade for all external service interactions. Calling domains (Eligibility, Workflow, Client Management) initiate requests — directly via Data Exchange endpoints or via rules in their own domain that trigger a submission when a relevant event occurs. Data Exchange executes the call, tracks the lifecycle, and emits result events that calling domains subscribe to in order to resume. It owns the catalog of available external services and the lifecycle of every external call made. It does not own the policy decisions that determine whether external data is needed, when to request it, or what to do with the result — those stay in the calling domain.

### How the pattern works

Three actors collaborate on every external service call:

**Calling domain** (e.g., Intake) submits a service call with two fields: the configured service to run (`serviceId`) and the ID of the record that triggered the call (`requestingResourceId`). No PII — no SSN, name, or date of birth — travels through the Data Exchange API surface. The calling domain also attaches any context it needs to resume when the result arrives (e.g., which verification obligation to update) as metadata on the service call.

**Adapter** (state-implemented code behind the Data Exchange endpoints) receives the submission, looks up the resource type for that service from the ExternalService catalog (`data-exchange-config.yaml`), fetches the sensitive input fields it needs directly from the source domain using system credentials, and calls the external service. The adapter is the only actor that ever touches PII.

**ExternalService catalog** (`data-exchange-config.yaml`) declares the resource path adapters fetch for each service type (e.g., `fdsh_ssa` → `intake/applications/members`), the default call mode, and the programs each service supports. States overlay this file to add their endpoint URLs. No credentials live here.

When the external service responds, the adapter posts the result back, a `call.completed` event fires, and the calling domain's rules resume — reading the metadata it attached earlier to route the result to the right record.

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

Federal data exchange services fall into two categories:

**CMS Federal Data Services Hub (FDSH)** — a CMS-operated routing layer that connects state eligibility systems to multiple federal data sources through a single interface. FDSH exposes discrete named services that can be called selectively; it is not a single bundled call. States configure which FDSH services to invoke based on the eligibility factor being verified. See [Decision 7](#decision-7-service-type-model).

**Income and Eligibility Verification System (IEVS)** — a federal mandate (7 CFR § 272.8, 45 CFR § 205.51) requiring states to query SSA, IRS, state wage records, and unemployment insurance. IEVS is a regulatory framework, not a single service — the underlying systems are separate with distinct interfaces, response schemas, and query cycles. See [Decision 17](#decision-17-ievs-as-regulatory-framework).

Other federal services: USCIS SAVE (immigration status), inter-state enrollment hubs (duplicate benefit checks), and SSA correctional facility data (incarceration status).

## Entity model

### ExternalService

The catalog of available external data sources. Each entry describes a type of external service the agency can call. Entries are defined at deployment time in `data-exchange-config.yaml` — not created via API at runtime. The blueprint defines entries for known federal services (IRS, SSA, USCIS SAVE, state wage databases); states overlay those entries with their endpoint configuration and add any state-specific services following the same schema.

Key fields:
- `id` — unique identifier
- `name` — human-readable name (e.g., "SSA Death Master File")
- `serviceType` — the specific federal service interface this entry represents: `fdsh_ssa`, `fdsh_vlp`, `fdsh_fti`, `fdsh_medicare`, `fdsh_vci`, `ssa_ievs`, `irs_ievs`, `swica`, `uib`, `save`, `enrollment_check`, `incarceration_check`. See [Decision 7](#decision-7-service-type-model) for the full service type reference.
- `defaultCallMode` — `sync` or `async`
- `programs` — which programs use this service (`snap`, `medicaid`, `tanf`, or `all`)
- `requestingResourceType` — the resource type adapters fetch when executing the call (e.g., `intake/applications/members`); adapters look this up from the catalog rather than callers passing it per-call. See [Decision 14](#decision-14-resource-type-in-service-config).

### ExternalServiceCall

The runtime resource tracking a single external service call from submission through resolution. Governs the call lifecycle and serves as the correlation handle adapters use when calling back with a result.

Key fields:
- `id`, `createdAt`, `updatedAt` — standard resource fields; `createdAt` is when the call was submitted, `updatedAt` when status last changed
- `serviceId` — which ExternalService was called
- `callMode` — `sync` or `async` for this specific call
- `status` — current state in the call lifecycle
- `requestingResourceId` — the resource that triggered the call (task ID, determination ID, etc.); combined with `serviceId`, serves as the idempotency key (see [Decision 8](#decision-8-idempotency-via-requestingresourceid--serviceid))
- `data` — optional object for non-PII per-call context fields (e.g., which programs to check); polymorphic on `serviceType` — each service type has a corresponding OpenAPI input schema component that defines the valid fields. See [Decision 15](#decision-15-per-service-input-schemas).

The ExternalServiceCall request body carries no PII input payload (SSN, name, date of birth, etc.). Adapters retrieve sensitive fields from the source domain using `requestingResourceId` and the `requestingResourceType` declared in the service catalog entry. See [Decision 13](#decision-13-no-pii-in-request-payload) and [Decision 14](#decision-14-resource-type-in-service-config).

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

## Out of scope

- **Policy decisions about when to call external services** — the rules that determine when a verification is needed live in the calling domain (Eligibility, Workflow), not in Data Exchange. See [Decision 6](#decision-6-calling-domains-own-subscription-logic).
- **Credential and secrets management infrastructure** — `data-exchange-config.yaml` holds connection parameters only; credentials are injected at deploy time by the state. See [Decision 9](#decision-9-credentials-not-in-config).
- **Computer Matching Agreements** — the formal data sharing agreements required by 5 U.S.C. § 552a between agencies are an operational state responsibility, not a blueprint contract concern.
- **Retry orchestration** — whether and when to retry a failed call is a calling domain concern; Data Exchange surfaces failure classification (see [Decision 10](#decision-10-failure-classification-via-failurereason)) but does not implement retry logic.
- **Result persistence beyond the event log** — the event log is the record of truth for call results; long-term storage and access control for result data are state infrastructure concerns.

## Key design decisions

| # | Decision | Summary |
|---|---|---|
| 1 | [Facade pattern](#decision-1-facade-pattern) | Other domains call Data Exchange; Data Exchange calls external services |
| 2 | [Sync and async both supported](#decision-2-sync-and-async-call-modes) | Call mode is per-call; the domain handles both |
| 3 | [External service catalog as domain-level config](#decision-3-external-service-catalog-as-domain-level-config) | Blueprint defines federal service entries and schema in `data-exchange-config.yaml`; states overlay with their endpoint config and add state-specific services |
| 4 | [VerificationSource superseded](#decision-4-verificationsource-superseded) | Workflow's planned VerificationSource is replaced by ExternalService/ExternalServiceCall |
| 5 | [Events as audit trail; ExternalServiceCall for lifecycle](#decision-5-events-as-audit-trail-externalservicecall-for-lifecycle) | CloudEvents log is the immutable audit record; ExternalServiceCall governs the call lifecycle and serves as the correlation handle |
| 6 | [Calling domains own subscription logic](#decision-6-calling-domains-own-subscription-logic) | The rules that determine when to call an external service live in the calling domain, not in Data Exchange |
| 7 | [Service type model](#decision-7-service-type-model) | Twelve discrete service types reflecting actual federal service interfaces; FDSH services prefixed `fdsh_`; IEVS sources as separate types |
| 8 | [Idempotency via requestingResourceId + serviceId](#decision-8-idempotency-via-requestingresourceid--serviceid) | Duplicate submissions are detected by checking for an existing pending call on the same resource and service |
| 9 | [Credentials not in config](#decision-9-credentials-not-in-config) | `data-exchange-config.yaml` holds connection parameters only; credentials are injected at deploy time |
| 10 | [Failure classification via failureReason](#decision-10-failure-classification-via-failurereason) | `call.failed` event carries a `failureReason` field so calling domains can distinguish retriable from non-retriable failures |
| 11 | [Partial results for multi-component service calls](#decision-11-partial-results-for-multi-component-service-calls) | Calls with selectable sub-components resolve to `completed` with `matchStatus: partial`; consumers evaluate sufficiency |
| 12 | [Event delivery and audit separation](#decision-12-event-delivery-and-audit-separation) | `/events` delivers results to subscribers; event store is the audit record; `/audit` endpoint deferred |
| 13 | [No PII in request payload](#decision-13-no-pii-in-request-payload) | ExternalServiceCall carries no PII; adapters use system credentials to fetch sensitive fields from the source domain |
| 14 | [Resource type in service config](#decision-14-resource-type-in-service-config) | Resource type declared in the ExternalService catalog entry; callers pass only `serviceId` and `requestingResourceId` |
| 15 | [Per-service input schemas](#decision-15-per-service-input-schemas) | `data` field is polymorphic on `serviceType`; per-service-type input schema components in OpenAPI, mirroring result schemas (Decision 7) |

---

### Decision 1: Facade pattern

**What's being decided:** Whether other domains call external services directly, or through a dedicated Data Exchange domain.

**Considerations:**
- IBM Cúram has a dedicated "Data Hub" that mediates all external data requests — program domains call the hub, not external systems directly.
- ServiceNow's Integration Hub is a distinct domain with its own API surface; workflows call Integration Hub actions.
- MITA 3.0 defines "Data Exchange" as a separate business area from Eligibility and Case Management.
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
- ServiceNow Integration Hub Spokes, Cúram's external interface definitions, and Salesforce Named Credentials are all defined as deployment-time configuration, not as runtime data created via API.
- The global config overlay (`config.yaml`) is for cross-cutting API style preferences — not a fit for a domain-specific service registry.

**Options:**
- **(A)** OpenAPI spec examples — catalog entries as example data in the OpenAPI spec. Conflates API schema with runtime configuration; exposes deployment-sensitive URLs in the spec.
- **(B)** Global config overlay — add a `services` section to `config.yaml`. Conflates cross-cutting API style preferences with domain-specific service registry data.
- **(C) ✓** Domain-level config file — `data-exchange-config.yaml` with JSON Schema validation; overlayable; follows the same artifact pattern as other domain config files.

**Customization:** States overlay `data-exchange-config.yaml` to add their endpoint configuration to the blueprint-defined federal service entries and to add any state-specific services.

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
- Domain events emitted on ExternalServiceCall transitions capture who called what service, when, and with what result — exactly the information federal audit requires.
- ExternalServiceCall also serves as the correlation handle: adapters call back to the ExternalServiceCall record when a result arrives.
- Treating ExternalServiceCall itself as the immutable audit record would duplicate information already in the event log and create an inconsistency — the event log is the audit record for all other domains.

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

**Options:**
- **(A)** Data Exchange owns subscription rules — `on:` triggers mapping domain events to service calls live in `data-exchange-rules.yaml`
- **(B) ✓** Calling domains own subscription rules — the `on:` triggers that initiate Data Exchange calls live in the calling domain's rules YAML; Data Exchange is a pure execution layer

**Customization:** States configure when external service calls are triggered by overlaying the relevant calling domain's rules YAML.

---

### Decision 7: Service type model

**What's being decided:** Whether to model federal service types at a functional abstraction level (grouping services by purpose) or at the level of individual federal service interfaces.

**Considerations:**
- CMS FDSH is a routing layer, not a single service. It exposes discrete named services — SSA Composite, Verify Lawful Presence (VLP), IRS/FTI, Medicare, Verify Current Income (VCI) — each with its own endpoint, inputs, and return schema. Grouping them into a single type obscures what a call returns and makes result schema validation impossible.
- IEVS (7 CFR § 272.8) is a regulatory mandate requiring states to query four separate sources: SSA, IRS, state wage records (SWICA), and unemployment insurance (UIB). Each has incompatible response structures and update cycles. A single `income_verification` type cannot represent them accurately.
- States need to know exactly what each service returns in order to build their adapters. Service type names should reflect the actual federal service interface.
- VLP requires both an A-Number and an immigration document number to run. When only an A-Number is available, or when VLP returns "Institute Additional Verification," SAVE is the appropriate follow-up. The calling domain's rules implement this tier logic (consistent with Decision 6); `fdsh_vlp` and `save` are separate service types with different inputs and result schemas.

**Blueprint-defined service types:**

**FDSH services** — routed through the CMS Federal Data Services Hub. Field-level specs in CMS FDSH Business Service Definitions (see References).

| Service type | FDSH service | Adapter needs | What it returns | Mode |
|---|---|---|---|---|
| `fdsh_ssa` | SSA Composite | SSN, name, DOB; sub-components to request via `data` field (SSN verification, citizenship, Title II, incarceration — selectable) | SSN validity; U.S.-born citizenship status; Title II (RSDI/SSDI) benefit amount and status; incarceration status. See [Decision 11](#decision-11-partial-results-for-multi-component-service-calls) for partial result handling. | Real-time |
| `fdsh_vlp` | Verify Lawful Presence | A-Number + immigration document number + document type | Class of Admission code; grant date; date of entry; Five Year Bar Met indicator; country of birth; country of citizenship at entry; SEVIS ID; sponsor indicator | Real-time |
| `fdsh_fti` | IRS / Federal Tax Information | SSN; tax year via `data` field (defaults to prior year) | MAGI income compatibility result (compatible or not); filing status; household size. Returns a flag, not raw figures. | Real-time |
| `fdsh_medicare` | Medicare | SSN or Medicare Beneficiary Identifier (MBI) | Medicare Part A enrollment status; Medicare Part B enrollment status | Real-time |
| `fdsh_vci` | Verify Current Income (Equifax) | SSN | Current employer-reported wages; employment status. Raw income figures, not a compatibility flag. Commercial service billed separately; optional. | Near real-time |

**IEVS sources** — 7 CFR § 272.8 requires states to query all four for SNAP; each is a separate system. Field-level specs in SSA data exchange manuals (see References).

| Service type | Source | Adapter needs | What it returns | Mode |
|---|---|---|---|---|
| `ssa_ievs` | SSA SVES / SOLQ | SSN; response record types to request via `data` field (Title II, Title XVI, 40-quarter work history — selectable) | SSN validation; Title II (RSDI/SSDI) benefit data; Title XVI (SSI) benefit data; 40-quarter work history | Batch or real-time |
| `irs_ievs` | IRS (direct IEVS batch) | SSN; tax year via `data` field | Prior-year unearned income — interest, dividends, capital gains. Raw figures, unlike `fdsh_fti`. | Batch |
| `swica` | State Wage Information Collection Agency | SSN (batch file) | Quarterly employer-reported wages by employer | Batch (quarterly) |
| `uib` | State unemployment system | SSN | UI claim status; weekly benefit amount; claim dates | Batch or real-time |

**Other federal services:**

| Service type | Source | Adapter needs | What it returns | Mode |
|---|---|---|---|---|
| `save` | USCIS SAVE (direct) | A-Number or document number + document type. Step 2 is initiated by USCIS response, not the caller. Field-level specs in USCIS SAVE documentation (see References). | Step 1: USCIS status code; Class of Admission; country of birth; employment authorization indicator. Step 2 (if inconclusive): DHS narrative; expiration date; DHS comments. Used as fallback when `fdsh_vlp` cannot resolve. | Real-time |
| `enrollment_check` | Inter-state enrollment hub | SSN, state, program (varies by hub) | Duplicate enrollment indicator across states and programs | Batch or real-time |
| `incarceration_check` | SSA Prison Verification System (PUPS) | SSN (batch file) | Confinement status matched against SSA beneficiary records | Batch |

**Options:**
- **(A)** Functional abstraction — group services by purpose (`income_verification`, `immigration_status`). Simpler type list but hides incompatible schemas; adapters cannot know what a call returns.
- **(B) ✓** Discrete service types per federal interface — each named service gets its own type; schemas are accurate; FDSH services prefixed `fdsh_` to make the routing layer visible.

**Customization:** States extend per-service-type result schemas via OpenAPI overlay to capture additional fields returned by their specific external service endpoints. States that do not use a particular service simply do not configure an ExternalService entry for that type.

---

### Decision 8: Idempotency via requestingResourceId + serviceId

**What's being decided:** How to prevent duplicate external service calls when a calling domain retries a submission.

**Considerations:**
- A duplicate IEVS or SAVE query has real cost and compliance implications — external agencies may count queries against the agency's usage, and duplicate calls create redundant audit records.
- `requestingResourceId` combined with `serviceId` forms a natural semantic idempotency key: there should only ever be one active call for a given resource against a given service at a time.
- If a `pending` call already exists for the same `requestingResourceId` + `serviceId`, the duplicate submission can be detected at the Data Exchange contract layer before reaching the external service.

**Options:**
- **(A)** No deduplication at Data Exchange — calling domains are responsible for not submitting duplicates
- **(B)** Caller-supplied idempotency key — calling domain passes an explicit key; Data Exchange deduplicates on it
- **(C) ✓** Semantic deduplication — Data Exchange checks for an existing `pending` call on the same `requestingResourceId` + `serviceId`; rejects or returns the existing call if found

---

### Decision 9: Credentials not in config

**What's being decided:** Where credentials for external services (API keys, certificates, OAuth tokens) live relative to `data-exchange-config.yaml`.

**Considerations:**
- Credentials in a config file would end up in version control, violating secrets management best practice.
- ServiceNow separates credential records from spoke definitions; Salesforce separates Named Credentials from integration configuration.
- `data-exchange-config.yaml` is an overlay point that states share and version; it is not a secrets store.

**Options:**
- **(A)** Credentials in `data-exchange-config.yaml` — simple but insecure
- **(B) ✓** Config file holds connection parameters only (endpoint URL, timeout, service version); credentials are injected at deploy time via environment variables or a state-configured secrets manager

---

### Decision 10: Failure classification via failureReason

**What's being decided:** Whether to distinguish between types of call failures so calling domains can react appropriately.

**Considerations:**
- A single `failed` state conflates connection errors (potentially retriable), service errors (potentially retriable), and authentication errors (not retriable without operational intervention).
- Calling domains need to know whether to retry, escalate, or proceed without the data — the appropriate response differs by failure type.
- `failureReason` in the event payload keeps the lifecycle simple (one `failed` state) while giving consumers the context they need.

**Options:**
- **(A)** Single `failed` state with no sub-classification — calling domains treat all failures identically
- **(B)** `failureReason` on the ExternalServiceCall resource — queryable but duplicates what is in the event
- **(C) ✓** `failureReason` in the `call.failed` event payload only — values: `connection_error`, `service_error`, `authentication_error`; resource stays lean

---

### Decision 11: Partial results for multi-component service calls

**What's being decided:** How service calls with selectable sub-components resolve when some sub-components are unavailable or return no match.

**Background:** `fdsh_ssa` is the primary case — callers select which sub-components to request (SSN validation, citizenship, Title II benefits, incarceration), and any of those sub-components may be unavailable if an upstream SSA source does not respond. `ssa_ievs` has a similar structure, with selectable response record types.

**Considerations:**
- Treating any unavailable sub-component as a full call failure discards useful data from the sub-components that did respond and forces a full retry.
- Adding a new `partial` lifecycle state complicates the state machine and every consumer.
- The calling domain is best positioned to decide whether the returned sub-components are sufficient to proceed — for example, a citizenship result may be sufficient to continue even if the Title II benefit amount is unavailable.
- `inconclusive` and `unavailable` are meaningfully different: `inconclusive` means data was returned but a match could not be determined (may need manual review); `unavailable` means the source did not respond (may warrant retry).

**Options:**
- **(A)** `failed` — any unavailable sub-component fails the whole call; useful sub-results discarded.
- **(B)** New `partial` lifecycle state — adds complexity to the state machine and all consumers.
- **(C) ✓** `completed` with `matchStatus: partial` — call resolves as completed; unavailable sub-components carry `matchStatus: unavailable`; sub-components that returned data but could not be matched carry `matchStatus: inconclusive`; consumer evaluates sufficiency.

**Sub-result structure:** Absent sub-results appear as objects with `matchStatus: unavailable` rather than being omitted. Named properties per sub-component (e.g., `citizenshipResult`, `titleIIResult`) allow each to carry its own typed schema.

---

### Decision 12: Event delivery and audit separation

**What's being decided:** How async results are delivered to calling domains, and how the audit record is maintained.

**Considerations:**
- For sync calls, the full result is returned in the HTTP response — no event subscription needed.
- For async calls, the `call.completed` event is the delivery mechanism — calling domains subscribe and receive the full result payload inline. Querying an event store to retrieve async results is inconsistent with event-driven architecture.
- The event store retains all events as the immutable audit record, consistent with the platform CloudEvents approach.
- A separate `/audit` endpoint is additive and can be introduced later without breaking contract changes, once access control and retention requirements are defined.
- Result payloads contain PII and FTI. The blueprint marks sensitive fields with `x-data-classification` so adapters know which fields require regulatory safeguards. How states implement those safeguards (encryption, access control, log masking) is an infrastructure concern. See [PII in event payloads](../../inter-domain-communication.md#pii-in-event-payloads).

**Options:**
- **(A)** Separate result endpoint — calling domains fetch results from `GET /external-service-calls/{id}/result`; creates a second retrieval path alongside event delivery
- **(B)** Event store query — calling domains query `/events` for past results; inconsistent with event-driven subscription model
- **(C) ✓** Event delivery with deferred audit endpoint — `call.completed` event carries the full result payload; calling domains subscribe and receive results inline; event store is the audit record; `/audit` endpoint deferred until access control and retention requirements are defined

---

### Decision 13: No PII in request payload

**What's being decided:** Whether the ExternalServiceCall submission includes PII input data (SSN, name, date of birth), or whether adapters retrieve sensitive fields themselves from the source domain.

**Considerations:**
- Including SSN and other PII in the ExternalServiceCall request body would encode sensitive field schemas into the blueprint contract and route PII through the Data Exchange API surface unnecessarily.
- The `requestingResourceId` + the resource type declared in the service catalog (Decision 14) gives the adapter everything needed to call the source domain API and retrieve sensitive fields.
- ServiceNow Integration Hub and Cúram Data Hub both follow this pattern — the calling process passes a record reference; the integration layer retrieves data as needed using system credentials.
- Keeping PII out of the request body means the ExternalServiceCall resource itself (returned by GET) contains no sensitive fields — only lifecycle state and identifiers.
- Adapters are trusted system actors deployed by the state, with system-level credentials scoped to read the source domain APIs they need. No dedicated PII endpoint is required; adapters call the same standard API endpoints that other consumers use, governed by access control.

**Options:**
- **(A)** PII inline — request body includes SSN, name, DOB, and other service-specific input fields. PII flows through the Data Exchange contract surface; blueprint spec encodes sensitive field schemas.
- **(B) ✓** No PII in request body — submission carries `serviceId`, `requestingResourceId`, and optionally `callMode` and `data`; adapters use system credentials to fetch sensitive fields from the source domain using `requestingResourceId` and the resource type from the service catalog.

---

### Decision 14: Resource type in service config

**What's being decided:** Whether adapters infer the resource type to fetch from the service catalog, or whether callers must pass it explicitly with each ExternalServiceCall submission.

**Considerations:**
- A bare `requestingResourceId` UUID gives adapters no type information — they cannot construct the source domain API call without knowing whether the resource is an ApplicationMember, a Task, or something else.
- Federal services map predictably to resource types: FDSH, IEVS, SAVE, and SSA all operate on member-level records (`intake/applications/members`). Requiring callers to pass this per-call is boilerplate with no flexibility benefit.
- ServiceNow spoke actions declare the target record type (`table`) in the action configuration, not per-invocation. Cúram integration events include entity type as a formal attribute of the exchange specification, not the runtime request. Both treat resource type as a catalog-level concern.
- If a state-specific service operates on a different resource type, they declare it in their overlay service config entry — no per-call change is needed.

**Options:**
- **(A)** Caller passes resource type — `requestingResourceType` field on each ExternalServiceCall submission. Flexible per-call but adds boilerplate for the common case where a service always operates on one type.
- **(B) ✓** Service config declares resource type — each ExternalService entry includes `requestingResourceType`; adapters look it up from the catalog. Callers pass only `serviceId` and `requestingResourceId`.

**Customization:** States overlay `data-exchange-config.yaml` to set the `requestingResourceType` appropriate for their service configuration. State-specific services may operate on different resource types than the baseline federal service entries.

---

### Decision 15: Per-service input schemas

**What's being decided:** How non-PII, per-call context fields (e.g., which programs to check, a check date) are passed to adapters and validated.

**Considerations:**
- Some external service calls require per-call configuration that varies by invocation and cannot be inferred from the requesting resource alone. For example, a citizenship check might cover only SNAP eligibility for one call, and both SNAP and Medicaid for another.
- These fields are not PII — they are configuration flags or context parameters. Putting them in the request body does not violate the Decision 13 constraint.
- ServiceNow spoke actions define typed input fields per action in the spoke definition; Cúram integration frameworks support typed input attributes per exchange type. Both define input schemas at the service type level, not inline per-call.
- Decision 7 defines per-service-type result schemas as OpenAPI components, discriminated by `serviceType`. The same pattern applied to input schemas keeps the full contract surface (request and result) in the OpenAPI spec rather than split across the spec and the service config.
- The codebase already uses a polymorphic field pattern (`subjectId` + `subjectType`) where a field's schema varies based on a sibling type discriminator. The `data` field follows this same pattern: `serviceType` on the ExternalServiceCall is the discriminator; per-service-type input schema components define what `data` contains for each type.

**Options:**
- **(A)** Open `data` object only — callers pass any fields in a freeform object; no schema validation. Adapters discover what fields are available without a contract.
- **(B)** Per-service `inputSchema` in service config — documented alongside deployment config in `data-exchange-config.yaml`. Input schemas are not discoverable via the OpenAPI spec; tooling cannot validate them.
- **(C) ✓** Per-service-type input schemas as OpenAPI components — ExternalServiceCall has a `data` field whose schema is polymorphic on `serviceType`, with per-service-type input schema components (e.g., `FdshSsaInputData` to specify which sub-components to request, `SsaIevsInputData` to specify which response record types to include) defined in the OpenAPI spec. Callers read the component for their service type to know what fields are valid. Mirrors Decision 7 for result schemas and the existing polymorphic field pattern.

**Customization:** States extend per-service-type input schemas via OpenAPI overlay to add state-specific non-PII input fields their adapters accept.

---

## Customization

States customize the Data Exchange domain primarily through `data-exchange-config.yaml` overlays and calling domain rules.

| Customization point | How |
|---|---|
| External service endpoint URLs | Overlay `data-exchange-config.yaml` — blueprint defines federal service entries with placeholder config; states fill in their endpoint URLs |
| Default call mode per service | Set `defaultCallMode` on any ExternalService entry in `data-exchange-config.yaml`; can be overridden per call by the calling domain |
| State-specific services | Add entries to `data-exchange-config.yaml` following the same schema as the blueprint-defined federal entries |
| Result schema extensions | Overlay per-service-type result schemas in the OpenAPI spec to capture additional fields returned by state-specific external service endpoints (see [Decision 7](#decision-7-service-type-model)) |
| When external service calls are triggered | Overlay the calling domain's rules YAML — Data Exchange is a pure execution layer; trigger logic stays in Eligibility, Workflow, or Client Management (see Decision 6) |

## Known gaps

- **Retry logic** — no defined mechanism for automatic retries on retriable failures (`connection_error`, `service_error`). States will need to implement retry orchestration in their calling domain rules or adapter layer.
- **Batch calls** — several service types (`irs_ievs`, `swica`, and quarterly `ssa_ievs`) are inherently batch-only: they operate on files submitted periodically rather than per-member requests. The current model creates one ExternalServiceCall per resource, which does not fit a batch submission pattern. Batch support would require a different lifecycle model — likely a parent-level batch submission record with child call records per member result.
- **Result caching and reuse** — no defined policy for reusing a recent result rather than making a new call. States performing repeated determinations on the same household may need to implement caching in their adapter layer.
- **Manual review resolution** — when a call result carries `matchStatus: pending_manual_review`, there is no defined mechanism for a caseworker to adjudicate and resolve the pending status. This likely belongs in the Workflow domain (a task type) but is not yet designed.
- **Audit endpoint** — deferred in Decision 12; access control and data retention requirements (#216) must be defined before this can be specified.
- **Rate limiting and usage tracking** — external agencies limit query volume; no mechanism is defined for tracking usage against agency-imposed quotas or rate limits.
- **Intake rules mismatch** — the current `intake-rules.yaml` creates `data-exchange/service-calls` resources with `applicationId` and `requestedAt`, but the ExternalServiceCall contract requires `serviceId`, `requestingResourceId`, and optionally `callMode` and `data`. This will be corrected when the data exchange OpenAPI contract is implemented (see #240).

## References

- Regulatory: 7 CFR § 272.8, 42 CFR § 435.940–965, 5 U.S.C. § 552a
- Standards: MITA 3.0 Business Architecture, CloudEvents
- Related docs: [Domain Design Overview](../domain-design.md), [Contract-Driven Architecture](../contract-driven-architecture.md), [Workflow Domain](workflow.md)

### Federal service specifications

Use these sources when designing OpenAPI result and input schemas for each service type (Decision 7).

- **CMS FDSH** — [FDSH Business Service Definitions](https://www.medicaid.gov/state-resource-center/mac-learning-collaboratives/downloads/acct-trnsfr-bsns-serv-def.pdf) — field-level specs for `fdsh_ssa`, `fdsh_vlp`, `fdsh_fti`, `fdsh_medicare`, `fdsh_vci`
- **SSA data exchange index** — [ssa.gov/dataexchange/applications.html](https://www.ssa.gov/dataexchange/applications.html) — index of all SSA data exchange applications
- **SSA SVES/SOLQ** — [SVES/SOLQ Manual](https://www.ssa.gov/dataexchange/documents/sves_solq_manual.pdf) and [SVES Record Layout](https://www.ssa.gov/dataexchange/documents/SVES%20record_July_2017.pdf) — field-level specs for `ssa_ievs`
- **SSA BENDEX** — [BENDEX Manual](https://www.ssa.gov/dataexchange/documents/BENDEXMANUAL2022.pdf) — Title II benefit and earnings data (overlaps with `ssa_ievs` Title II response)
- **SSA SDX** — [SDX Record Data Elements](https://www.ssa.gov/dataexchange/documents/SDX%20record.pdf) — Title XVI SSI data (overlaps with `ssa_ievs` Title XVI response)
- **USCIS SAVE** — [SAVE Verification Process](https://www.uscis.gov/save/about-save/save-verification-process) and [SAVE Tutorial](https://www.uscis.gov/sites/default/files/document/flyers/SAVETutorial%20-%20April%202025%20Updates.pdf) — field-level specs for `save`
