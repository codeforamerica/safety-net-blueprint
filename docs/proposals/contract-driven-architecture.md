# Proposal: Contract-Driven Architecture for Portability

**Status:** Draft

**Sections:**

1. **[Context](#context)** — Contract-driven architecture for backend and frontend portability
2. **[Contract Artifacts](#contract-artifacts)** — What contracts a domain needs, by API type
3. **[How the Contracts Work](#how-the-contracts-work)** — What each contract artifact looks like, how they connect, and standards alignment
4. **[From Contracts to Implementation](#from-contracts-to-implementation)** — Adapter pattern, contracts as requirements, development to production
5. **[What States Get From This Project](#what-states-get-from-this-project)** — Contracts, tooling, and mock server

---

## Context

Safety net program implementations depend on a range of backend systems and must render context-dependent UI across multiple programs. This project uses a contract-driven architecture to achieve portability at both layers — APIs and UI are defined as contracts, and implementations are swappable without changing what depends on them.

At the **backend**, contracts provide vendor independence. The adapter pattern translates between contracts and vendor-specific systems — swap vendors by reimplementing the adapter, not the frontend. The contract complexity varies by system type: **data-shaped** systems (databases, document stores, identity providers) need only an API interface (OpenAPI spec), while **behavior-shaped** systems (workflow engines, rules engines, notification platforms) need richer behavioral contracts — state machines, rules, and metrics — that capture what the system must enforce, decide, and measure.

At the **frontend**, form definition contracts provide independence from domain-specific rendering logic. The frontend renders sections, fields, and annotations from declarative definitions without hardcoding decisions about what to show based on programs, roles, or eligibility groups. Adding a program, changing which sections a role sees, or introducing eligibility-driven fields is a contract change, not a code change.

This proposal describes how to define contracts for both layers, organized around two API types: **Object APIs** and **Action APIs**.

## Contract Artifacts

Every domain needs contracts. What contracts you need depends on whether the domain is data-shaped or behavior-shaped — which maps to the two API types.

### Object APIs

Object APIs are CRUD operations on objects — create, read, update, delete, list, search. Every domain has these. The contract is an OpenAPI spec that defines the object schemas, endpoints, and query parameters.

**Examples:**
- `GET /persons`, `POST /persons`, `GET /persons/:id`
- `GET /applications`, `POST /applications`
- `GET /workflow/tasks`, `GET /workflow/queues`

Object APIs are straightforward to make portable. A `Person` looks the same regardless of whether it's stored in PostgreSQL, Salesforce, or a legacy system. The adapter maps between the OpenAPI contract and the vendor's data model.

Some domains only need Object APIs — persons, applications, households, income, documents. The data model is the value, and CRUD is the full interface. These domains need one contract artifact:

- **OpenAPI spec** — object schemas, endpoints, query parameters

### Action APIs

Action APIs are behavioral operations on objects — they trigger state transitions, enforce business rules, and produce side effects. Some domains need these in addition to Object APIs.

**Examples:**
- `POST /workflow/tasks/:id/claim` — transitions a task from `pending` to `in_progress`, enforces assignment rules
- `POST /workflow/tasks/:id/escalate` — transitions to `escalated`, creates audit event, may trigger notifications
- `POST /workflow/tasks/:id/complete` — validates the caller is the assignee, transitions to `completed`

Action APIs are harder to make portable because the value is in orchestration and enforcement, not just data. A workflow engine provides state machine enforcement, task routing, SLA tracking, auto-escalation, audit trails, and event-driven triggers. A rules engine provides evaluation, conflict resolution, and explanation capabilities. A notification system provides multi-channel orchestration, retry logic, and delivery tracking.

A generic CRUD adapter loses most of this value. The adapter pattern still applies, but the contract needs to be richer than just an OpenAPI spec. Action API domains need two or more contract artifacts:

- **OpenAPI spec** — same object schemas used by the Object APIs
- **State machine YAML** (required) — valid states, transitions, guards, effects, timeouts, SLA behavior, audit requirements, notification triggers, and event catalog
- **Rules YAML** (optional) — declarative rules with logic conditions and actions. Rule types include assignment, priority, eligibility, escalation, alert, and more. Only needed when the domain involves condition-based decisions beyond what guards express (e.g., routing objects to queues based on context, setting priority based on application data, alert thresholds for operational monitoring).
- **Metrics YAML** (optional) — defines what to measure for operational monitoring. Metric names, labels, source linkage (which states/transitions produce the data), and targets — not implementation details (Prometheus vs. Datadog is a deployment concern).

Every behavior-shaped domain needs a state machine — that's what makes it behavior-shaped. Rules are an additional artifact for domains that need condition-based decisions evaluated against broader context. Metrics are an additional artifact for domains that need operational monitoring. For example, workflow management needs state machine + rules + metrics. A simple approval process may only need the state machine.

### Any domain: form definitions

Regardless of API type, any domain may also need:

- **Form definition YAML** (optional) — defines form structure, field visibility conditions, field-level validation, and dependencies between fields. Needed when the frontend must render forms differently based on context (e.g., which program a person is applying for determines which sections and fields appear). Unlike the behavioral contracts above, the form definition's primary consumer is the **frontend**, which interprets it to render context-dependent UI. The adapter may also use parts of it for server-side logic (e.g., which records to create based on program requirements). A data-shaped domain with multi-program forms needs OpenAPI + form definition. A behavior-shaped domain like application review needs OpenAPI + state machine + form definition.

---

## How the Contracts Work

Each contract artifact captures a different concern. **Behavioral contracts** (state machine, rules, metrics) define what the backend must enforce, decide, and measure — the adapter or vendor system interprets them. **Form definitions** define what the frontend must render — the frontend interprets them. Together they cover both portability layers.

### State machine

The state machine YAML defines the lifecycle of an object — its states, transitions, who can trigger them, what conditions must hold, and what side effects must occur. It follows [statechart semantics](https://statecharts.dev/) written as custom YAML with a JSON Schema defining the format.

```yaml
# Simplified example — a task that can be claimed and completed
states:
  pending:
    transitions:
      - to: in_progress
        trigger: claim
        actors: [caseworker]
        guard: taskIsUnassigned
        effects:
          - set: { assignedToId: $caller.id }
          - create: TaskAuditEvent
          - notify: { channel: email, recipient: $object.supervisorId, template: task-claimed }

# Custom top-level field — added by the workflow domain to handle creation-time orchestration.
# Domains extend the base schema with fields like this as requirements emerge.
onCreate:
  effects:
    - evaluate-rules: workflow-rules    # References the rules YAML file
      description: Route task to queue and set priority
```

Each `trigger` becomes an Action API endpoint — `claim` on `Task` in the `workflow` domain becomes `POST /workflow/tasks/:id/claim`. Effects are declarative side effects (create records, update fields, send notifications, evaluate rules) that must occur when a transition fires.

### Complex calculation logic

Some domains involve calculation logic beyond what the rules artifact is designed to express — eligibility determination, tax calculation, risk scoring. Where `evaluate-rules` invokes the portable rules YAML that ships with the contracts, a custom `call` effect type can be added for when the logic lives in a dedicated external engine. The contract defines when calculations happen (which transition), what goes in and comes out (OpenAPI schemas), and how results are audited (effects) — without prescribing how the calculations work. `call` is an example of extending the base effect types to meet domain-specific needs, the same way `onCreate` extends the base top-level fields.

### Rules

Rules are a separate YAML artifact for condition-based decisions — routing, assignment, prioritization, escalation, eligibility. The rules file is context-agnostic — it doesn't know what object it operates on. The state machine provides context when it fires an `evaluate-rules` effect: the governed entity is bound to a context variable, so the same rules structure could apply to tasks, applications, or any other object with the referenced fields. The binding name is domain-specific — `object` is used as a placeholder in these examples, but a real domain would use its own name (e.g., `task.*` in workflow, `application.*` in intake).

```yaml
# workflow-rules.yaml — referenced by: evaluate-rules: workflow-rules
route-snap-tasks:
  ruleType: assignment
  condition: { "==": [{ "var": "object.programCode" }, "SNAP"] }
  action: { assignToQueue: "snap-processing" }

high-priority-expedited:
  ruleType: priority
  condition: { "==": [{ "var": "object.isExpedited" }, true] }
  action: { setPriority: high }
```

Rule types (like `assignment` and `priority`) and what their actions mean (like `assignToQueue` and `setPriority`) are domain-specific — the exact schema for defining these is a design detail to be worked out during implementation. What the proposal establishes is the pattern: rules are declarative, keyed by ID (so state overlays can target individual rules), and invoked by the state machine via effects. Conditions need a portable, serializable expression format — [JSON Logic](https://jsonlogic.com/) is a lightweight option with implementations in most languages, though alternatives like CEL or FEEL could be substituted if more expressive power is needed. The contract YAML uses one canonical format so the shared tooling (mock server, validation, tests) only needs one evaluator. States that prefer a different expression language author in that language and have their conversion scripts translate to the canonical format when generating the YAML — the same tool-agnostic pattern used for authoring tools.

### Metrics

Metrics define what to measure — metric names, labels, targets, and where the data comes from. Each metric's `source` references specific states or transitions in the state machine by name, which is how the two artifacts link together. They specify *what* to measure, not *how* to collect it.

```yaml
# Simplified example — measure how long tasks wait before being claimed.
task-time-to-claim:
  description: Time from task creation to first claim
  source:
    from: pending          # State name from the state machine
    to: in_progress        # State name from the state machine
    trigger: claim         # Transition trigger name from the state machine
  target:
    p95: 4h                # 95th percentile target (also supports p50, p99, max, avg, etc.)
```

### Form definitions

Form definitions describe context-dependent form structure — which sections and fields to display, visibility conditions, validation rules, and field dependencies. They link to the OpenAPI spec (field names, types, enums), not the state machine — they're about rendering data, not lifecycle.

```yaml
# Simplified example — show SNAP-specific fields only for SNAP applications
sections:
  - id: snap-details
    label: SNAP Information
    visibleWhen: { "in": [{ "var": "application.programs" }, "SNAP"] }  # Same expression format as rules (e.g. JSON Logic)
    fields:
      - id: householdSize
        type: integer
        required: true
```

**Source paths** — Field definitions use dot-notation paths to link UI fields to OpenAPI schema fields. The first segment is the schema name (e.g., `member` for ApplicationMember, `income` for Income); subsequent segments are field names, including nested paths (e.g., `member.citizenshipInfo.status`). The validation script verifies these paths resolve — if a field definition references a path that doesn't exist in the schema, validation fails.

**How the frontend uses form definitions:**

1. **Section list** — The server creates work item records (e.g., SectionReview) from the form definition's program requirements on submission. The frontend fetches these records and uses each record's `sectionId` to look up the matching section in the form definition. The form definition provides labels, field definitions, and annotations — the work item records provide the list.

2. **Section visibility** — `visibleWhen` conditions on section definitions act as client-side checks. In practice, these agree with the server-created records — if no record exists for a section, the `visibleWhen` condition would also be false. Both mechanisms reinforce each other.

3. **Field rendering with annotations** — Within a section, each field renders with its annotations. The frontend iterates over whatever annotation types exist and renders them — it doesn't need to know what they mean.

The adapter's role is to serve form definitions to the frontend (possibly after resolving state overlays) and to use parts of them for server-side logic (e.g., determining which records to create during `onCreate`). Visibility conditions use the same expression format as rule conditions (e.g., JSON Logic), so the same evaluation library works for both. See [Extensibility and customization](#extensibility-and-customization) for how annotation types scale.

#### Standards alignment

The form definition format is custom but informed by established standards. No single standard covers the full use case (declarative form structure with program-specific annotations for government benefits), but the core patterns have well-known precedents.

| Our concept | Standard | How it aligns |
|---|---|---|
| OpenAPI schemas (data) + form definition (UI) | [JSONForms](https://jsonforms.io/) / [RJSF](https://rjsf-team.github.io/react-jsonschema-form/) dual-schema | Same separation — JSON Schema defines data types and constraints, a separate UI artifact defines presentation and layout. Our OpenAPI schemas are the data schema; our form definition YAML is the UI schema. |
| `visibleWhen` conditions | FHIR Questionnaire [`enableWhen`](https://hl7.org/fhir/questionnaire.html), ODK XForms [`relevant`](https://getodk.github.io/xforms-spec/) | Same concept — a condition on a form element that controls whether it appears. FHIR uses operator-based comparisons; ODK uses XPath expressions; we use JSON Logic expressions. |
| JSON Logic as expression language | [Form.io](https://form.io/) conditional visibility, [SurveyJS](https://surveyjs.io/) | Form.io uses JSON Logic for advanced form conditions — same library, same purpose. JSON Logic is lightweight, serializable, and has implementations in most languages. |
| Sections with scope (per-member) | ODK XForms [groups and repeats](https://getodk.github.io/xforms-spec/) | ODK's `repeat` element allows sections to occur 0-N times — our `per-member` scope is the same concept. |
| Field `source` paths (dot-notation) | JSONForms [JSON Pointer](https://datatracker.ietf.org/doc/html/rfc6901) (`#/properties/name`) | Same concept — linking a UI field to its data source. JSONForms uses RFC 6901 JSON Pointer syntax; we use dot-notation for readability in tables. |
| Field annotations (relevance, verification, regulatory citations) | FHIR Questionnaire [extensions](https://hl7.org/fhir/questionnaire.html) | Novel — no standard has per-field annotations describing how different contexts use a field. FHIR's extension system is the closest model. Our approach is simpler: annotation types as table columns, scaling to a generalized annotations table. |
| Program requirements table | *(no direct equivalent)* | Novel — a matrix of which sections each program requires, used for server-side record creation on submission. Specific to multi-program eligibility domains. |

**Design decisions:**

- **Why not adopt FHIR Questionnaire wholesale?** FHIR Questionnaire is healthcare-specific and carries significant structural overhead (nested item trees, answer option sets, coded values). Our use case is caseworker review forms, not patient questionnaires. The patterns transfer; the format doesn't.
- **Why not adopt JSONForms wholesale?** JSONForms is a runtime rendering framework, not a contract format. We borrow its dual-schema architecture but define our own YAML structure suited to table-based authoring and the conversion pipeline.
- **Why JSON Logic over alternatives?** JSON Logic is the lightest serializable expression language with broad adoption in form frameworks. Alternatives: FHIRPath (healthcare-specific), XPath (verbose, XML-oriented), CEL (more powerful but less adopted in form tooling). JSON Logic fits our authoring model — conditions that non-developers can read in a table cell.

### Extensibility and customization

All contract artifacts — state machine, rules, metrics, form definitions — are declarative YAML governed by JSON Schema, making them diffable and reviewable in PRs. The common extensibility principle: adding capabilities means adding entries to existing structures (rows, fields, types), not restructuring the format. Consumers — adapters, frontends, validation scripts — iterate over whatever they find rather than hardcoding expectations about specific entries.

**State machine** — New effect types (e.g., `audit`, `notify`, `call`) are added to the schema and implemented as handlers in the adapter. Adding an effect type doesn't change existing transitions. New guard types (role-based, time-based, external service checks) follow the same pattern — the evaluation engine dispatches on guard type. Domains extend the base schema with top-level fields as requirements emerge (e.g., `onCreate`, `onTimeout`, `bulkActions`).

**Rules** — New decision tables are independent — adding a table doesn't affect existing ones. New condition operators or action types extend the rules schema without restructuring existing rules.

**Metrics** — New source types (state duration, transition count, field value aggregation) and new dimensions for slicing (by program, by worker, by time period) are additive. Adding a metric is adding rows to the metrics table.

**Form definitions** — Field-level annotations (program relevance, verification requirements, role-based guidance) are extensible by type. Adding an annotation type means adding rows to an annotations table — the frontend renders whatever types it encounters without knowing what they mean. Annotation values can be structured — strings for simple guidance, arrays of acceptable items, or objects with links to external APIs, policy documents, or verification services. Authoring tables can use either format: columns for annotation types that apply to most fields, or a separate table for sparse types. Both produce the same generalized structure:

| Section | Field | Annotation Type | Context | Value |
|---------|-------|-----------------|---------|-------|
| income | amount | relevance | SNAP | gross amount counted |
| income | amount | relevance | Medicaid | net amount for MAGI |
| income | amount | verification | all | pay stub, employer letter, or tax return |
| income | amount | regulation | SNAP | 7 CFR 273.9(a) — Gross income determination |

Adding a new annotation type or a new audience adds rows — no structural change to the table or the frontend.

All artifacts include a `version` field for change tracking. The validation script can diff two versions of any artifact and report breaking vs. non-breaking changes — removing a state, transition, rule, metric, or form field is breaking; adding one is not. This applies consistently across all artifact types, the same way OpenAPI spec versioning works.

### Authoring experience

The YAML formats are build artifacts, not files that anyone edits by hand. Business users and developers author in tables (spreadsheets), and conversion scripts generate the YAML.

**Table-based workflow:** Each concern gets its own table — state transitions, guards, effects, decision rules, metrics. The tables are structured with enough detail for conversion scripts to generate YAML directly. In a spreadsheet, each table would be a separate sheet; the conversion script joins them by trigger or guard name.

Because the YAML is always generated from the tables, nobody edits it by hand. When a table row changes, the script regenerates the YAML. When a row is removed, the corresponding YAML is removed too — which is correct, since the transition or rule no longer exists.

**Example — separate tables for the same transition:**

*Transitions table:*

| From | To | Trigger | Who | Guard | Effects |
|------|-----|---------|-----|-------|---------|
| pending | in_progress | claim | caseworker | Task is unassigned | Assign to worker, create audit event |

*Guards table:*

| Guard | Field | Operator | Value |
|-------|-------|----------|-------|
| Task is unassigned | `assignedToId` | is null | — |

*Effects table:*

| Trigger | set | create |
|---------|-----|--------|
| claim | `assignedToId` = `$caller.id` | TaskAuditEvent (`assigned`) |

The same pattern applies to decision tables (conditions and actions with field references) and metrics tables (metric names, source linkage to states and transitions, targets).

**Tool-agnostic:** The conversion scripts are the integration point, not the authoring tool. The default workflow uses spreadsheets (Excel, Google Sheets), but if a state prefers Camunda Modeler for state machines or a DMN editor for rules, they need a conversion script for that tool's export format. The tool produces the business-level content; developer implementation details come from a companion source (additional columns, a separate sheet, or annotations in the tool — whatever fits). The output is always the same YAML.

---

## From Contracts to Implementation

### The adapter pattern

The adapter translates between contracts and vendor-specific systems. Swap vendors by reimplementing the adapter, not the frontend.

For **Object APIs**, the adapter wraps a vendor's data store with a standard interface defined by the OpenAPI spec. The frontend sees the same API regardless of what's behind the adapter.

```
[Frontend] → [Adapter] → [Vendor/DB]
                 ↑
              Object APIs (GET /tasks, POST /tasks)
```

For **Action APIs**, the adapter wraps a vendor system (workflow engine, rules engine) and exposes both Object APIs and Action APIs. The frontend calls Object APIs for data reads (`GET /workflow/tasks`) and Action APIs for behavioral operations (`POST /workflow/tasks/:id/claim`). The adapter translates both to the vendor's system.

```
[Frontend] ──────► [Adapter] ──────► [Vendor System]
                      ↑
                    Object APIs (GET /tasks, POST /tasks)
                    Action APIs (POST /tasks/:id/claim)
```

The adapter must satisfy the contract artifacts for the domain — for Action APIs, that means more than just an OpenAPI spec. When you switch vendors, the contracts tell you exactly what the new backend must do.

### Contracts as requirements

The behavioral contract defines **what must happen** — not how the adapter implements it. The adapter and vendor system together satisfy the contract, but how they divide the work depends on the vendor:

- **Full workflow/rules engine** (Camunda, Temporal, Drools) — The vendor handles state transitions, guards, effects, and timeouts natively. The adapter translates between the contract's HTTP surface and the vendor's APIs. The contract artifacts are configuration requirements for the vendor, not code the adapter executes.
- **Simple backend** (database + application code) — The adapter orchestrates the behavior itself: enforcing transitions, evaluating guards, running effects, tracking SLA clocks. The contract artifacts are a specification the adapter interprets directly.
- **Hybrid** — The vendor handles some concerns natively (e.g., state transitions, timeouts) while the adapter orchestrates others (e.g., cross-domain effects, rule evaluation).

So when the contract says "these effects must occur on this transition," it's a requirement, not an execution instruction. When `onCreate` says "evaluate routing rules and create an audit record after object creation," it specifies the required outcome — not that the adapter must intercept the POST and run effects itself. A workflow engine might handle this as a native initialization step. A simpler backend might have the adapter orchestrate the effects inline.

### Development to production

During development, the frontend talks to the mock server. In production, it talks to the production adapter:

```
Development:
  [Frontend] → [Mock Server] → [State Machine Engine + In-memory DB]

Production:
  [Frontend] → [Adapter] → [Vendor System]
                   ↑
           Validated against contract
```

The mock server is the development adapter. Swapping from mock to production changes the adapter internals, not the frontend code.

**Transition steps:**

1. **Develop** frontends against the mock server — the mock serves as the initial adapter
2. **Evaluate** vendors against the behavioral contract
3. **Select** vendor and configure their engine to match the contract
4. **Build** a vendor-specific adapter that exposes the same API surface
5. **Validate** — run the integration test suite to verify conformance
6. **Swap** — point frontend to production adapter
7. **Retire** mock server for that domain

The contracts double as a **vendor evaluation checklist**: can this system support these transitions? These effects? These rule conditions? These SLA behaviors? If a vendor can't satisfy the contracts, you know before you buy.

---

## What States Get From This Project

This project provides contracts and development tooling. States build their own production backends — in whatever language or framework they use — that satisfy those contracts.

| Artifact | Audience | Purpose |
|----------|----------|---------|
| OpenAPI specs | Developers | Define the Object API surface (schemas, endpoints, parameters) |
| State machine YAML | Developers | Define the Action API surface (states, transitions, guards, effects, events, notifications, audit requirements) |
| Rules YAML | Developers | Define condition-based decisions: routing, assignment, priority, alerts |
| Metrics YAML | Developers | Define what to measure: metric names, labels, source linkage, targets |
| Form definition YAML | Developers | Define context-dependent form structure, field visibility, validation, and dependencies |
| Validation script | Developers | Verify contract artifacts are internally consistent (state machine states match OpenAPI enums, effect targets reference real schemas, event payloads resolve, audit requirements satisfied) — runs in CI |
| Mock server | Developers | Self-contained adapter with in-memory database for frontend development and integration testing |
| Integration test suite | Developers | Auto-generated from contracts (transition tests, guard tests, effect verification, event emission checks). Tests verify outcomes, not implementation — it doesn't matter whether the adapter or vendor executed an effect, as long as the expected side effects occurred |
| Decision tables | Business analysts + developers | Spreadsheets defining conditions and actions for routing, assignment, priority — conversion scripts generate the rules YAML |
| State transition tables | Business analysts + developers | Spreadsheets defining transitions, guards, and effects across related tables — conversion scripts generate the state machine YAML |
| Form definition tables | UI designers + developers | Spreadsheets defining sections, fields, visibility conditions, and validation — conversion scripts generate the form definition YAML |
| State machine visualizations | Business analysts | Auto-generated diagrams from the state machine YAML showing states, transitions, and actors |
| ORCA data explorer | All | Interactive tool for exploring API contracts — schemas, endpoints, relationships, and domain structure |

Adding a new domain to the mock server is declarative — define artifacts, not code. Add an OpenAPI spec and the mock auto-generates CRUD endpoints; add a state machine YAML and it auto-generates Action API endpoints with transition enforcement, effects, and rule evaluation.

States don't have to use the base contracts as-is. An overlay system lets states customize any contract artifact — OpenAPI specs, state machine YAML, rules, metrics, form definitions — without forking the base files. Overlays use JSONPath targeting to add, modify, or remove specific elements (e.g., add a state-specific rule, adjust a metric target, modify a transition's guard, add fields to a form section). The base contracts plus overlays produce a merged result that the validation script and integration tests run against, so customizations are still verified for consistency.

**How a state uses this:**

1. Install the contracts as a dependency
2. Apply overlays to customize contracts for state-specific needs
3. Develop frontends against the mock server
4. Build a production backend (the adapter) that exposes the same API surface, translating to their vendor systems
5. Run the integration test suite against the production backend to verify conformance
6. Swap the frontend from mock server to production backend
