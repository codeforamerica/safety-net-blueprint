# Behavioral Contract DSL

This document is the architecture reference for the behavioral contract DSL — the YAML-based language used to define state machines, procedures, SLA conditions, and metric filters across all Safety Net Blueprint domains. It covers the three-layer DSL model, expression syntax, condition and branching syntax, function model, and event-driven execution. Standards evaluated: CNCF Serverless Workflow, OMG BPMN 2.0, OMG CMMN, W3C SCXML. Vendor systems compared: Camunda/Zeebe, AWS Step Functions, IBM BPM, and Pega.

> Supersedes [Decision 26: JSON Logic as the rule condition expression language](../domains/workflow-design-reference.md#decision-26-json-logic-as-the-rule-condition-expression-language) in the Workflow Design Reference.

## Overview

The behavioral contract DSL defines the dynamic behavior layer of the blueprint — what domain objects do over their lifetime, who can act on them, and what happens in response to those actions. It is additive to the OpenAPI specs. The OpenAPI specs define the resource model: CRUD endpoints, schema shapes, and query parameters. The state machine declares lifecycle-specific transition endpoints on top of those resources — each transition becomes a `POST /{resource}/{id}/{transitionId}` endpoint that is merged into the OpenAPI spec at resolve time. Together they form a complete API contract: the OpenAPI spec describes the shape; the state machine describes who can do what, when, and what happens as a result.

The DSL appears in three artifact types across all domains:

| Artifact | Purpose | Schema |
|---|---|---|
| `*-state-machine.yaml` | Domain object lifecycle: states, authorized transitions, event subscriptions, procedures, and named handlers | [`state-machine-schema.yaml`](../../../packages/contracts/schemas/state-machine-schema.yaml) |
| `*-sla-types.yaml` | SLA definitions: pause/resume conditions and deadline thresholds | [`sla-types-schema.yaml`](../../../packages/contracts/schemas/sla-types-schema.yaml) |
| `*-metrics.yaml` | Metric definitions: filter predicates and aggregation expressions | [`metrics-schema.yaml`](../../../packages/contracts/schemas/metrics-schema.yaml) |

These artifacts define the behavioral contracts that all state implementations must conform to. States implement the defined behavior in their vendor system of choice (Salesforce, IBM Cúram, Camunda, etc.) — the DSL is the specification, not the runtime. The mock server provides a reference implementation for development and testing.

## Contract structure

The DSL spans three artifact types. All three share the same expression syntax, step vocabulary, and context model.

### State machine files (`*-state-machine.yaml`)

A state machine file covers one domain and may contain multiple machines — one per governed entity type. Domain files can extend `platform-state-machine.yaml` to inherit shared guards and procedures. The precedence chain is platform → domain → machine: each level can override definitions from the level above using the same id.

```
platform-state-machine.yaml          domain-state-machine.yaml
├── guards:  (platform-wide)          ├── extends: ./platform-state-machine.yaml
└── procedures: (platform-wide)       ├── machines:
                                      │   └── (one per governed entity type)
                                      │       ├── object:       entity type name
                                      │       ├── states:       valid lifecycle positions
                                      │       ├── initialState: state on creation
                                      │       ├── context:      named data bindings
                                      │       ├── transitions:  actor/system-triggered state changes
                                      │       ├── events:       event subscriptions
                                      │       ├── guards:       conditions scoped to this machine
                                      │       └── procedures:   step sequences scoped to this machine
                                      ├── guards:     conditions shared across all machines
                                      └── procedures: step sequences shared across all machines
```

**Machine** — a machine governs one entity type. It is the self-contained specification for that entity: what states it can be in, who can change it, what events it reacts to, and what logic runs in response. A file can contain more than one machine — for example, `intake-state-machine.yaml` contains machines for both `Application` and `Verification`, because both are governed by the intake domain.

**States** — the named positions an entity can occupy in its lifecycle (`draft`, `submitted`, `under_review`, `closed`). Each state declares whether the processing clock (`slaClock`) is running or stopped. An entity is always in exactly one state. States represent meaningful distinctions in the entity's lifecycle — the difference between `submitted` (awaiting caseworker pickup) and `under_review` (actively being reviewed) determines whether the SLA clock is ticking and who can act on the entity.

**Guards** — named boolean conditions that control access to transitions. Each guard has a `condition:` expression and an id that can be referenced by name in transition definitions. Guards centralize access control logic — rather than repeating `"caseworker" in caller.roles` in every transition that requires a caseworker, a guard named `callerIsCaseworker` is declared once and referenced everywhere it applies.

**Events** — the machine's subscriptions to named domain events. When an event arrives with a matching `name:`, the machine runs the associated steps. Object creation, field changes, and timer callbacks all arrive as events — see [Decision 4](#decision-4-fully-event-driven-model). Event subscriptions can load additional context (e.g., look up the application referenced in the event payload) before running their steps.

**Transitions** — actor- or system-triggered state changes. Each transition is an action a caller can explicitly request — it becomes a `POST /{domain}/{resource}/{id}/{transitionId}` endpoint. A transition declares a human-readable `description:` for the generated endpoint, optional `schema:` with `request:` and `response:` sub-schemas for the POST body and 200 response, who can call it (`guards:`), what state the entity must currently be in (`from:`), what state it moves to (`to:`), and what steps run. Transitions without a `to:` are in-place actions that don't change the entity's state. Request body fields are available in steps as `$request.fieldName`.

**Procedures** — named step sequences that can be called from events, transitions, or other procedures via `call:`. Procedures keep complex logic from being duplicated across multiple call sites. A procedure inherits all context already in scope at the call site; parameterized procedures accept additional arguments via `with:`, referenced as `$params.name` inside the procedure.

**Context** — named data bindings that load related records from other API resources and make them available as named variables. Each binding is `name: { from: resource-path, where: { field: value } }`. Context can be declared at any scope — machine, event, transition, or procedure — wherever the data is needed. See the [Context section](#context) below.

### SLA type files (`*-sla-types.yaml`)

Named SLA definitions that specify when the processing clock starts, pauses, and what the deadline is. Pause and resume conditions are boolean expressions evaluated against the object state. SLA types are referenced from state machine states and can be customized via overlay.

### Metrics files (`*-metrics.yaml`)

Named metric definitions with filter predicates and aggregation expressions. Used for operational reporting — queue depth, processing time distributions, SLA compliance rates.

## The three layers

The DSL consists of three conceptually distinct layers. No single external standard covers all three. See [Decision 2](#decision-2-evaluating-standards-as-alternatives-to-the-custom-dsl) for why.

### Domain lifecycle layer

Declares what domain objects are, what states they can be in, and who can act on them. This is the `machines:`, `states:`, `transitions:`, and `guards:` sections. The vocabulary is aligned with statechart concepts (SCXML, XState): named states, guarded transitions, and initial state declarations.

### Execution layer

Declares what happens when events fire: which events a machine subscribes to, what procedures run in response, and what steps those procedures execute. This is the `events:` and `procedures:` sections.

### Expression layer

A single expression language — CEL (Common Expression Language) — used throughout all three artifact types: guard conditions, step conditions, SLA pause/resume conditions, and metric filter predicates. See [Decision 1](#decision-1-cel-as-the-expression-language).

## Expressions

Condition expressions appear in guards, `if:` and `match:` steps, SLA pause/resume conditions, and metric filter predicates. Common patterns:

| Pattern | Example |
|---|---|
| Field equality | `object.status == "submitted"` |
| List membership | `"snap" in object.programs` |
| List size | `object.programs.size() == 1` |
| Null check | `object.field != null` |
| Logical and / or | `a && b` / `a \|\| b` |
| Negation | `!condition` |
| Any in list satisfies | `object.programs.exists(p, p == "snap")` |
| All in list satisfy | `object.programs.all(p, p != null)` |

Guards are named conditions declared in a `guards:` section and referenced by name from transitions:

```yaml
guards:
  - id: callerIsCaseworker
    condition: '"caseworker" in caller.roles'
  - id: taskIsUnassigned
    condition: object.assignedToId == null
```

## Condition and branching syntax

Conditional logic lives at the step layer — `if` and `match` are step types, composable with any other step in a step list.

### if step

```yaml
- if: '"snap" in object.programs'
  then:
    - call: createSnapVerifications
  else:
    - call: skipSnapVerifications
```

`else:` is optional. `if` steps compose naturally — they can appear at any position in a step list and can be nested.

### match step

```yaml
- match: object.category
  when:
    identity:
      - call: initiateIdentityCheck
    income:
      - call: initiateIncomeChecks
    immigration:
      - call: initiateImmigrationCheck
```

`when:` keys are the matched values. Each branch is a step list. `match` steps can appear anywhere in a step list alongside `if` and other step types.

## Function model

Procedures are invoked by name (string form). HTTP operations use the object form with the HTTP method as the key.

```yaml
# Named procedure call — with optional parameters
- call: createProgramVerifications
  with: {program: snap, memberCategories: [income, identity]}

# HTTP call — inline form
- call: {POST: intake/applications/$application.id/open}
- call: {POST: data-exchange/service-calls, body: {serviceId: $params.serviceId}}
```

When a procedure declares `parameters:`, callers pass values via `with:`. Inside the procedure, parameters are referenced as `$params.name`.

### Context

`context:` declares named data bindings — each binding fetches a related record and makes it available as `$name` or `$name.field` in steps. Context can be declared at any scope where it makes sense:

| Scope | When to use |
|---|---|
| Machine | Stable configuration shared by all events, transitions, and procedures in the machine — e.g. named queues, service records. Resolved once per machine invocation. |
| Event subscription | Data specific to the event being handled — e.g. the task or application referenced in the event payload. Resolved fresh on each event. |
| Transition | Data specific to that transition — e.g. a related record needed only for that operation. |
| Procedure | Optional additions for a specific procedure when the caller's scope doesn't already provide them. Most procedures need no local context — they inherit everything already in scope. |

Inner scope wins when the same alias appears at multiple levels. A binding may reference any alias already resolved above it in the same block or from any outer scope level.

```yaml
# Compact single-line form used throughout
context:
  - fdshSsaService: {from: data-exchange/services, where: {serviceType: fdsh_ssa}}
  - task: {from: workflow/tasks, where: {id: $this.subject}}
```

## Event model

All machine reactions are named event subscriptions in the `events:` section. Object creation, field changes, and timer callbacks use the same event subscription model as cross-domain events.

```yaml
events:
  - name: intake.application.submitted
    steps:
      - call: createProgramVerifications
  - name: workflow.task.claimed
    context:
      - task: {from: workflow/tasks, where: {id: $this.subject}}
    steps:
      - call: openApplication
```

All events are CloudEvents. The `name:` field is the CloudEvents `type` attribute.

## Timer design

Time-based callbacks follow the same event subscription model as all other events. See [Decision 5](#decision-5-timer-as-event).

### Shared timer procedures

Two built-in shared procedures encapsulate the timer boilerplate:

```yaml
- call: requestTimer
  with:
    timerId: '"intake.snap_deadline." + $object.id'
    fireAfter: P30D   # ISO 8601 duration; use fireAt + fireOffset for deadline-relative
    calendarType: calendar   # or: business
    callback: {event: '"intake.snap_deadline"', data: {}}
- call: cancelTimer
  with: {timerId: '"intake.snap_deadline." + $object.id'}
```

`fireAfter` accepts an ISO 8601 duration (`P30D` = 30 days, `PT72H` = 72 hours). Use `fireAt` with an ISO 8601 timestamp when the deadline is stored on the object; combine with `fireOffset` (e.g. `"-PT48H"`) to fire before it. See [Scheduling Service](scheduling-service.md) for the full event contract.

### Receiving the callback

Each timer type is a named domain event. The machine subscribes to it directly, the same way it subscribes to any other event:

```yaml
timers:
  - id: snap_deadline
    description: 30-calendar-day SNAP processing deadline

events:
  - name: intake.snap_deadline
    steps:
      - call: {POST: intake/applications/$this.subject/auto-deny, body: {reason: snap_deadline_exceeded}}
```

The `timers:` section declares the timer types the machine uses. The event name follows the convention `{domain}.{id}` — `intake.snap_deadline` for a timer declared in the `intake` domain with id `snap_deadline`. The scheduling service fires the callback event exactly as specified in the original request; no dispatch on a `timerType` field is needed.

The scheduling service is a separate contract boundary — see [Scheduling Service](scheduling-service.md) for the full event contract, timer ID conventions, and implementation guidance. Because timers are events, timer behavior is testable via the same event stub mechanism used for all other events.

## Domain-owned HTTP endpoints

Each transition defined in a state machine is a domain-owned HTTP endpoint. The state machine is the authoritative source for what endpoints a domain exposes — the OpenAPI spec for that domain is generated from it. This means the behavioral contract DSL, not the OpenAPI spec directly, is what adapter implementers and the mock server use to understand what endpoints must exist and what they do.

The endpoint URL follows a predictable pattern derived from the domain and transition `id`:

```
POST /{domain}/{resource}/{id}/{transitionId}
```

For example, the `submit` transition on `Application` in `intake-state-machine.yaml` generates:

```
POST /intake/applications/{applicationId}/submit
```

Transition IDs use kebab-case verbs (`complete-review`, `mark-inconclusive`). This naming is what ties the behavioral contract (what the transition does, who can call it, what state it produces) to the HTTP surface (the generated OpenAPI path). Adapter implementers must implement every transition defined in their domain's state machine. The mock server generates routes from the same definitions. See [Resolve Pipeline Architecture](../resolve-pipeline.md) for how generation works.

## Key design decisions

| # | Decision | Summary |
|---|---|---|
| 1 | [CEL as the expression language](#decision-1-cel-as-the-expression-language) | CEL replaces JSON Logic across the full behavioral contract surface. Supersedes Decision 26 in the Workflow Design Reference. |
| 2 | [Standards evaluation](#decision-2-evaluating-standards-as-alternatives-to-the-custom-dsl) | CNCF Serverless Workflow, BPMN 2.0, and CMMN were evaluated as alternatives. No standard covers all three DSL layers; the custom DSL is retained with vocabulary aligned to recognized concepts. |
| 3 | [Internal consistency](#decision-3-internal-consistency) | `if`/`match`/`when` as step types, `call:` for all invocations, guards as CEL conditions. Removes parallel condition syntaxes within the execution layer. |
| 4 | [Fully event-driven model](#decision-4-fully-event-driven-model) | `onCreate:`, `onUpdate:`, and `onTimer:` are removed. All machine reactions — including creation, field changes, and timer callbacks — are expressed as named event subscriptions. |
| 5 | [Timer-as-event](#decision-5-timer-as-event) | Timers are requested and delivered as events. Predictable timer IDs are required. The scheduling service contract defines the event boundary. |

---

### Decision 1: CEL as the expression language

**Status:** Decided: D

**What's being decided:** Which expression language replaces JSON Logic across the full behavioral contract surface — guards, procedure conditions, step conditions, SLA conditions, and metric filters — now that the DSL spans multiple domains and includes procedure and step conditions that benefit from a more readable syntax.

**Background:** JSON Logic was chosen in Decision 26 in the Workflow Design Reference for consistency across guards, SLA conditions, and metric filters. That decision did not evaluate CEL. As the blueprint grew to multiple domains and the state machine DSL expanded to include procedure and step conditions, the verbose object syntax of JSON Logic (`{"==": [{"var": "object.status"}, "submitted"]}`) became a readability and authoring concern — particularly for the human-readable condition strings that caseworkers and policy staff write when extending the DSL via overlay.

**Considerations:**
- JSON Logic (~1.24M weekly npm downloads) is an open spec not tied to any library or runtime. But its nested object syntax is designed for machine generation, not human authoring. A simple equality check requires three nested keys.
- FEEL (OMG/DMN standard, used in Camunda/Zeebe and IBM ODM) has excellent date arithmetic (`duration("P30D")`) and is the language policy analysts use in Camunda decision tables. It is positioned as business-analyst-friendly. However, `=` not `==` for equality is a persistent footgun for anyone from a C-family background — every developer will write `==` first and get silent failures. The main implementations are Java-based with limited JavaScript support.
- JSONata (~1M weekly npm downloads, adopted by AWS Step Functions in November 2024) excels at JSON transformation and data reshaping. For boolean condition use cases, it offers no advantage: it also uses `=` not `==`, date arithmetic requires millisecond math (`$toMillis($now()) - $toMillis(submittedAt) <= 2592000000`), and the transformation power is irrelevant to the blueprint's condition-only use cases.
- CEL (Google standard, used in Kubernetes admission policies, Firebase security rules, OpenFGA, Envoy, and Kyverno) uses familiar `==` syntax, handles list membership (`"snap" in programs`), list size (`programs.size()`), and quantifiers (`programs.exists(p, p == "snap")`). A JavaScript implementation is available. It was not evaluated in Decision 26.

**Options:**
- **(A)** Keep JSON Logic — consistent with prior decision, but verbose for human authoring; the original rationale (consistency across the contract surface) applies equally to any alternative adopted uniformly
- **(B)** FEEL — DMN standard, excellent date arithmetic, but `=`/`==` footgun and Java ecosystem dependency
- **(C)** JSONata — popular and AWS-backed, but same `=`/`==` footgun, poor date arithmetic, transformation power adds no value for condition use cases
- **(D) ✓** CEL — familiar developer syntax, widely used in cloud-native tooling, no footguns, YAML-native, not evaluated in the original decision

**Decision:** CEL (D). The original argument for JSON Logic — consistency across the contract surface — applies equally to any language adopted uniformly. Among the evaluated alternatives, CEL is the only one with familiar `==` syntax, no ecosystem lock-in, and a YAML-native string format readable without tooling. FEEL's date arithmetic is the strongest argument against CEL, but ISO 8601 duration strings cover the SLA use cases without FEEL's syntax, and the `=`/`==` footgun is too significant for a surface authored by developers.

---

### Decision 2: Evaluating standards as alternatives to the custom DSL

**Status:** Decided: D

**What's being decided:** Whether to replace the custom behavioral contract DSL with an established standard, and if so which one — motivated by the concern that states adopting the blueprint must learn a novel vocabulary not grounded in any published standard.

**Background:** The DSL covers three conceptually distinct layers: domain lifecycle (states/operations/guards), execution model (triggers/procedures/steps), and expression language. No single standard covers all three, which means any standard adoption is partial.

**Considerations:**

*CNCF Serverless Workflow* covers the execution model well: event-triggered states, operation states, switch states, and forEach states map directly to triggers/procedures/steps. CloudEvents integration is built in. However, CNCF has no concept of domain object lifecycle states — CNCF "states" are workflow execution nodes (operation, switch, foreach, sleep), not persistent domain object statuses like `draft` or `submitted`. There is no authorization model (guards, actors). Functions are not reusable across workflow definitions — machine-level shared context has no equivalent, requiring each workflow to fetch its own dependencies. The default expression language is jq, which has complex syntax. The project is at CNCF Sandbox level (the least mature CNCF tier) with limited production adoption. Adopting CNCF for procedures while keeping a custom lifecycle layer would produce a hybrid with two formats in every state machine file — more complex, not less.

*BPMN 2.0* is the dominant process standard, supported natively by Camunda, Activiti, jBPM, IBM BPM, and Zeebe. States using those engines could import BPMN and execute it directly. However, BPMN is XML-only with no YAML representation. Domain lifecycle states require mapping to implicit token positions in a process flow rather than explicit named object statuses. Authorization is not modeled natively. Equivalent logic is 3–4× more verbose than the current DSL.

*CMMN (Case Management Model and Notation)*, an OMG standard alongside BPMN, is specifically designed for knowledge-intensive case work. It defines stages (lifecycle phases), sentries (entry/exit conditions that function like guards), and case file items (domain objects) — the closest conceptual fit of any evaluated standard. However, CMMN is XML-only, is less widely adopted than BPMN, and its sentry model covers stage entry/exit conditions but not actor-based authorization. Primarily implemented in Camunda and IBM BPM.

*YAML-format BPMN:* No official YAML serialization of BPMN 2.0 exists. A custom YAML-to-BPMN transpiler would keep YAML readability and produce importable BPMN XML, but the lifecycle layer would still require custom vocabulary — and maintaining the transpiler is comparable in scope to maintaining the DSL schema.

**Options:**
- **(A)** Adopt CNCF Serverless Workflow for execution layer — stops maintaining execution model spec, but 3× verbosity, no shared context, lifecycle layer remains custom, jq expressions
- **(B)** Adopt BPMN 2.0 — states using Camunda/Activiti could execute directly, but XML-only, lifecycle states are implicit in token position, no auth model
- **(C)** Adopt CMMN — closest domain model fit, but XML-only, limited adoption, no auth model
- **(D) ✓** Retain custom DSL, document alignment to recognized standards

**Decision:** Retain the custom DSL (D). The domain lifecycle layer has no standard equivalent — every major vendor (Salesforce, ServiceNow, IBM Cúram, Pega) treats domain lifecycle configuration as proprietary. Any standard adoption leaves the lifecycle layer custom regardless, producing a hybrid. The execution layer vocabulary (events, procedures, invoke, emit, forEach) is already aligned with CNCF concepts; this document makes that alignment explicit. The expression layer uses CEL (Decision 1). The concern driving the evaluation — that state developers must learn a novel vocabulary — is addressed by explicitly documenting how each DSL layer maps to recognized standards and concepts.

---

### Decision 3: Internal consistency

**Status:** Decided: B

**What's being decided:** How to eliminate parallel constructs that express the same concept in different syntax across the DSL — conditions, invocations, and event triggers.

**Background:** As the DSL grew, parallel constructs accumulated:
- Procedure-level `when:` and step-level `when:` served the same conditional role at different scopes
- `switch:`/`cases:` was a separate dispatch construct at the procedure level
- `invoke:` and `call:` both invoked callable things but for different call targets (HTTP vs procedure)
- Guards used a field/operator/value format; procedure and step conditions used JSON Logic's object syntax — two different formats for the same concept of conditional evaluation
- `onTimer:` was a special-cased trigger type alongside event-based triggers

**Considerations:**
- When two constructs express the same concept, an author must learn both and choose between them. Making `if` and `match` step types unifies all conditional logic at the step layer — the scope (procedure-level or step-level) does not require a different syntax.
- `call:` and `invoke:` are semantically identical: invoke a callable thing, pass arguments. The distinction between HTTP operations and procedures is an implementation detail that should not be visible at the call site.
- Guards in field/operator/value format evaluate the same objects as CEL conditions. The different format exists for historical reasons, not design reasons. Named CEL conditions are more expressive and consistent with the rest of the expression layer.
- `onCreate:`, `onUpdate:`, and `onTimer:` as special-cased trigger types are addressed by Decision 4.

**Options:**
- **(A)** Keep parallel constructs for backward compatibility during transition
- **(B) ✓** Unify: `if`/`match`/`when` as step types, `call:` for all invocations, guards as CEL conditions

**Decision:** Unify (B). Concrete changes:
- `if` and `match`/`when` are step types. Procedure-level `when:` and `switch:`/`cases:` are removed; the equivalent is expressed as the first step(s) in the procedure's step list.
- Guards are named CEL conditions. The field/operator/value format is removed.
- `call:` is the single invocation step type. `invoke:` is removed; HTTP operations and procedures are both callable by name.

Removal of special-cased trigger types (`onCreate:`, `onUpdate:`, `onTimer:`) is a separate decision. See [Decision 4](#decision-4-fully-event-driven-model).

---

### Decision 4: Fully event-driven model

**Status:** Decided: B

**What's being decided:** Whether all machine reactions — object creation, field changes, and timer callbacks — should be expressed as named event subscriptions, eliminating the special-cased `onCreate:`, `onUpdate:`, and `onTimer:` trigger types.

**Background:** The original DSL had three distinct trigger categories alongside the `events:` section: `onCreate:` for creation-time side effects, `onUpdate:` for field-change reactions, and `onTimer:` for time-based transitions. These were framework-special-cased hooks, not events. The `events:` section handled cross-domain event subscriptions separately. As the blueprint grew to multiple domains, this split model meant the execution layer had two parallel mechanisms for "something happened, run these steps" — the `triggers:` block for internal lifecycle events and the `events:` block for cross-domain events.

**Considerations:**
- Creation, field changes, and timer callbacks are all "something happened" signals. They differ only in their source. Treating them differently at the DSL level requires authors to learn two parallel models.
- In an event-driven system, internal lifecycle events (task created, task updated) are domain events like any other. Emitting `workflow.task.created` when a task is created, then subscribing to it in the same machine, is consistent with how cross-domain events already work — and it means the creation side effects are traceable in the event log.
- Temporal, AWS Step Functions, and Azure Durable Functions all use event subscriptions rather than framework hooks for lifecycle reactions. Treating `onCreate:` as an implicit framework hook has no industry equivalent at the workflow engine level.
- The `onUpdate:` hook required the framework to track which fields changed. In the event-driven model, the domain emits `workflow.task.updated` with a list of changed fields, and the subscriber filters with a CEL condition — a pattern that composes with the standard event model rather than requiring a special field-watch mechanism.
- Eliminating `triggers:` entirely means every machine reaction — regardless of source — appears in the `events:` section. A reader sees the full reactive behavior of a machine in one place. See [Decision 5](#decision-5-timer-as-event) for the timer-specific consequence of this choice.

**Options:**
- **(A)** Keep `triggers:` as a separate block alongside `events:` — simpler to read for creation/update cases, but maintains two parallel models and hides lifecycle reactions from the event log
- **(B) ✓** Fully event-driven — `onCreate:`, `onUpdate:`, and `onTimer:` become named event subscriptions in `events:`; all machine reactions visible in one place

**Decision:** Fully event-driven (B). The `triggers:` block is removed. `onCreate:` becomes a subscription to the domain's own creation event (e.g., `workflow.task.created`). `onUpdate:` becomes a subscription to the domain's update event (e.g., `workflow.task.updated`) with a CEL condition filtering on changed fields. `onTimer:` is replaced by the timer-as-event pattern (Decision 5).

---

### Decision 5: Timer-as-event

**Status:** Decided: B

**What's being decided:** How to handle time-based triggers without a special-cased `onTimer:` trigger type — keeping the event model internally consistent. This is a direct consequence of [Decision 4](#decision-4-fully-event-driven-model).

**Background:** Time-based triggers appear in SLA enforcement (SNAP 30-day processing deadline, Medicaid 45-day deadline, interview scheduling reminders). The previous `onTimer:` trigger type broke the event-driven model.

**Considerations:**
- The timer-as-event pattern — emit a scheduling request, receive a callback event when it fires — is used by Temporal, AWS Step Functions (wait states), and Azure Durable Functions. It is a well-established pattern in event-driven systems.
- Cancellation is expressible as a cancellation event, keeping the model event-driven throughout.
- The scheduling service is a contract boundary, not a blueprint-owned domain. States implement it using their infrastructure of choice, keeping the blueprint runtime-agnostic.

**Options:**
- **(A)** Keep `onTimer:` — simpler to read for common cases, but breaks event-driven consistency and is not cancellable without additional special-casing
- **(B) ✓** Timer-as-event — `scheduling.timer.requested` and a named callback event per timer type; scheduling service is a state-implemented contract boundary and pure relay

**Decision:** Timer-as-event (B). All triggers are events — timer callbacks follow the same subscription model as every other machine reaction. Each timer type is a named domain event declared in the state machine `timers:` section. Predictable timer IDs are a required convention. See [Scheduling Service](scheduling-service.md) for the full event contract and timer event naming.

---

## References

- [Google CEL specification](https://github.com/google/cel-spec)
- [CNCF Serverless Workflow specification](https://serverlessworkflow.io/)
- [OMG BPMN 2.0](https://www.omg.org/spec/BPMN/2.0/)
- [OMG CMMN 1.1](https://www.omg.org/spec/CMMN/)
- [W3C SCXML](https://www.w3.org/TR/scxml/)
- [ISO 8601 Duration format](https://en.wikipedia.org/wiki/ISO_8601#Durations)
- [Workflow Design Reference — Decision 26 (superseded)](../domains/workflow-design-reference.md#decision-26-json-logic-as-the-rule-condition-expression-language)
- [Resolve Pipeline Architecture](../resolve-pipeline.md)
- [Inter-Domain Communication](../../decisions/inter-domain-communication.md)
