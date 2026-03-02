# Proposal: Workflow Management Prototype

**Status:** Draft

**Sections:**

1. **[Workflow Management](#workflow-management)** — The use case, what the system does, walkthrough
2. **[Prototype Scope](#prototype-scope)** — What's covered, what's deferred
3. **[OpenAPI Schemas](#openapi-schemas)** — Task, Queue, SLAType, TaskAuditEvent, TaskClaimedEvent
4. **[State Transition Table](#state-transition-table)** — Task lifecycle, guards, effects, request bodies
5. **[Decision Tables](#decision-tables)** — Assignment and priority rules
6. **[Metrics Summary](#metrics-summary)** — What to measure, source types, targets
7. **[Audit Requirements](#audit-requirements)** — What every transition must produce

---

## Workflow Management

A caseworker opens a task queue. Tasks arrive from different programs — SNAP, Medicaid, TANF — and each needs different handling: different routing rules, different SLA deadlines, different skill requirements. Building this as imperative code means each endpoint manually checks state, updates fields, creates audit records, and fires events. Adding a transition means writing a new endpoint with all its orchestration logic.

The risk: behavioral requirements — valid transitions, guards, effects, routing rules, SLA tracking, audit — get embedded in vendor-specific implementations with no portable specification. Switching workflow engines means reverse-engineering what the current system does, and there's no way to validate that a new vendor satisfies the same requirements before you commit to it. A behavioral contract addresses this by making requirements explicit, testable, and vendor-independent. It also doubles as a vendor evaluation checklist — can this system support these transitions, these effects, these SLA behaviors? — and enables frontend development against a mock server before any vendor is selected.

This prototype takes a different approach: the system reads **behavioral contracts** — a state machine that declares valid transitions, guards, and effects, plus rules that declare routing and priority decisions. The mock server auto-generates RPC API endpoints from the state machine. Adding a transition is a row in a table, not a new endpoint.

### What the system does

| Capability | Example |
|-----------|---------|
| **Routes tasks based on configuration** | A SNAP task is routed to the snap-intake queue. A generic task goes to general-intake. Routing rules are defined in a decision table — adding a program is a table row, not a code change. |
| **Enforces valid state transitions** | A task in `pending` can be claimed but not completed. A task in `in_progress` can be completed or released. The state machine rejects invalid transitions automatically — no per-endpoint validation code. |
| **Checks guards before allowing actions** | A caseworker can only claim an unassigned task and must have the required skills. Only the assigned worker can complete or release. Guards are declared in the state machine, not coded in each endpoint. |
| **Produces audit records on every action** | Claim, complete, release — each transition creates an audit event with who did it, when, and the state change. The validation script verifies every transition produces an audit record. |
| **Tracks SLA deadlines from configuration** | A SNAP expedited task gets a 7-day SLA. The clock runs in `pending` and `in_progress`, stops on `completed`. SLA parameters are looked up from configuration on creation, not hardcoded. |
| **Supports conditional follow-up tasks** | Completing a task with `createFollowUp: true` automatically creates a new task in the queue. Conditional effects fire only when their `when` clause is true. |

### What the caseworker sees

A minimal task queue UI with:
- **Task list** — filtered by status and queue (REST API: `GET /workflow/tasks`)
- **Queue list** — shows available queues (REST API: `GET /workflow/queues`)
- **Task detail** — shows a single task with SLA info, assignment, audit history
- **Action buttons** — Claim, Complete, Release (RPC APIs: `POST /workflow/tasks/:id/{action}`)
- **Event stream** — real-time updates when tasks change (SSE: `GET /events/stream?domain=workflow`)

This is not a production UI — it's the minimum needed to exercise every API type through a browser.

### Walkthrough

**Setup:**
1. The tables from this document are in spreadsheet format (CSV or Excel)
2. Conversion scripts generate the state machine YAML, rules YAML, and metrics YAML from the tables
3. Validation script confirms the generated YAML is internally consistent (states match OpenAPI enums, effect targets reference real schemas, rule context variables resolve)
4. Mock server loads the generated YAML and seed data (SLAType records, two queues: snap-intake and general-intake)

Steps 1-3 prove the authoring pipeline. Steps 4+ prove the runtime behavior.

**1. Create a SNAP task** — `POST /workflow/tasks` with `programType: "snap"`, `slaTypeCode: "snap_expedited"`, `isExpedited: true`

*What happens (onCreate effects):*
- `lookup`: SLAType loaded by `slaTypeCode`, `dueDate` and `slaInfo` computed
- `evaluate-rules`: assignment rule #1 matches (SNAP → snap-intake queue), priority rule #1 matches (isExpedited → expedited)
- `create`: TaskAuditEvent with eventType `created`
- Task appears in the task list in `pending` state, `expedited` priority, assigned to `snap-intake` queue, with a due date 7 days out

**2. Claim the task** — `POST /workflow/tasks/:id/claim` as a caseworker with matching skills

*What happens:*
- Guards checked: `assignedToId` is null (pass), `$caller.skills` contains all `$object.requiredSkills` (pass)
- `set`: `assignedToId` = caller
- `create`: TaskAuditEvent with eventType `assigned`
- `event`: `task.claimed` emitted — event stream shows the event with TaskClaimedEvent payload
- Task moves to `in_progress` in the UI

**3. Try to claim it again** — `POST /workflow/tasks/:id/claim` as a different caseworker

*What happens:*
- State machine rejects: task is `in_progress`, not `pending` — 409 response
- Demonstrates state enforcement

**4. Try to complete as wrong user** — `POST /workflow/tasks/:id/complete` as a caseworker who is NOT the assigned worker

*What happens:*
- Guard `callerIsAssignedWorker` rejects: `assignedToId` does not equal `$caller.id` — 409 response
- Demonstrates guard enforcement

**5. Release the task** — `POST /workflow/tasks/:id/release` as the assigned caseworker with `reason: "need different skills"`

*What happens:*
- Guard passes (caller is assigned worker)
- `set`: `assignedToId` = null
- `create`: TaskAuditEvent with eventType `returned_to_queue`
- `evaluate-rules`: routing rules re-evaluated (still matches snap-intake)
- Task returns to `pending` in the UI, unassigned, back in queue

**6. Claim and complete with follow-up** — claim again, then `POST /workflow/tasks/:id/complete` with `outcome: "approved"`, `createFollowUp: true`

*What happens:*
- Claim: same as step 2
- Complete: guard passes, `outcomeInfo` set from request
- `create`: TaskAuditEvent with eventType `completed`
- `when`: `$request.createFollowUp` is true → new Task created in `pending` state
- Original task moves to `completed` (SLA clock stops), follow-up task appears in queue
- Demonstrates conditional `when` effect

**7. Verify the audit trail** — `GET /workflow/task-audit-events?taskId=:id`

*What happens:*
- Returns the full sequence of eventTypes: `created` → `assigned` → `returned_to_queue` → `assigned` → `completed`
- Each record includes `previousValue`/`newValue` showing the state change (e.g., `returned_to_queue` event has previousValue `in_progress`, newValue `pending`)
- Demonstrates audit requirements are satisfied — every transition produced a record with all required fields

**8. Check metrics** — `GET /metrics`

*What happens:*
- `task_time_to_claim`: shows duration from step 1 to step 2 (and step 5 to step 6)
- `tasks_in_queue`: shows current count in `pending` state (the follow-up task)
- `release_rate`: shows 1 release out of total transitions
- Demonstrates all three metric source types

### What this proves

| What | How |
|------|-----|
| Tables → YAML conversion works | Setup: conversion scripts generate valid YAML from spreadsheet tables |
| Validation catches inconsistencies | Setup: validation script confirms generated YAML is internally consistent |
| REST APIs work | Task list, queue list, audit event list, SLAType lookup |
| RPC APIs are auto-generated from triggers | claim, complete, release endpoints exist without handler code |
| State machine enforces valid transitions | Step 3: claim on `in_progress` → 409 |
| Guards enforce preconditions | Step 4: wrong caller → 409 |
| Effects execute on transitions | Audit events created, fields updated, events emitted, rules evaluated |
| `onCreate` runs on creation | SLA calculated, rules evaluated, audit created before first transition |
| Conditional effects work | Step 6: follow-up task only created when requested |
| Rules evaluate correctly | SNAP routes to snap-intake, isExpedited sets priority |
| Events stream to frontend | Step 2: task.claimed appears in SSE stream |
| Metrics are queryable | Step 8: all three source types return data |
| Mock server replaces process API layer | Entire walkthrough runs against mock with no hand-written orchestration code |

---

## Prototype Scope

This document follows the **steel thread** approach — the thinnest end-to-end slice needed to prove a specific part of the [contract-driven architecture](../architecture/contract-driven-architecture.md). This prototype proves the **behavioral contract artifacts** (state machine, rules, metrics) at depth, applied to the task lifecycle. The [application review prototype](application-review-prototype.md) complements this by proving form definitions — the one artifact type this prototype doesn't touch. Between the two, every artifact type is covered. They can be done in either order.

> **Authoring note:** The tables in this document are the authoring format. Conversion scripts read them and generate the state machine YAML, rules YAML, and metrics YAML — the YAML is a build artifact that nobody edits by hand. In a spreadsheet, each table would be a separate sheet (transitions, guards, effects, rules, metrics), and the conversion script joins them by trigger or guard name. See [Authoring Experience](../architecture/contract-driven-architecture.md#authoring-experience) for the full workflow.

### Architecture concepts exercised

Each row is a concept from the [contract-driven architecture](../architecture/contract-driven-architecture.md). The right column shows where this prototype exercises it.

| Concept | Exercised by |
|---------|-------------|
| REST APIs (OpenAPI schemas → CRUD) | Task, Queue, SLAType, TaskAuditEvent |
| RPC APIs (triggers → endpoints) | `claim`, `complete`, `release` |
| State machine (states, transitions, initial state) | 3 states, 3 transitions + `onCreate` |
| SLA clock behavior | `running` (pending, in_progress), `stopped` (completed) |
| Guard: null check | "task is unassigned" on claim |
| Guard: cross-object comparison | "worker has required skills" on claim |
| Guard: caller identity | "caller is assigned worker" on complete, release |
| Effect: `set` | Every transition |
| Effect: `create` | TaskAuditEvent on every transition |
| Effect: `lookup` | SLAType on create |
| Effect: `evaluate-rules` | onCreate + release |
| Effect: `event` | `task.claimed` on claim |
| Effect: conditional `when` clause | Follow-up task on complete |
| `onCreate` (domain extension) | SLA lookup + rules + audit on task creation |
| Rules: assignment type | 2 rules (1 specific match + 1 catch-all) |
| Rules: priority type | 1 rule |
| Rules: context declaration | `task.*` |
| Metrics: duration source | task_time_to_claim |
| Metrics: state count source | tasks_in_queue |
| Metrics: transition count source | release_rate |
| Audit requirements | Formal declaration with required fields |
| Request bodies | Defined for each action |
| Event payload schema | TaskClaimedEvent |
| Conversion scripts (tables → YAML) | State transition table → state machine YAML, decision tables → rules YAML, metrics table → metrics YAML |
| Form definitions | Not exercised here — see [application review prototype](application-review-prototype.md) |

### What's not in the prototype

Capabilities deferred beyond this prototype:

- **Additional states** — `escalated`, `cancelled`, `returned_to_queue`, `awaiting_client`, `awaiting_verification`. These are more transitions using the same effect types, not new concepts.
- **Additional transitions** — escalate, reassign, cancel, bulk-reassign. Same effect patterns as claim/complete/release.
- **Verification workflow** — `VerificationTask`, `VerificationSource`, start/complete verification. Could be a separate state machine or nested states.
- **Cross-domain rule context** — rules that reference `application.*` or `case.*` data (e.g., household composition). Requires context binding beyond `task.*`.
- **Notifications** — effects that send emails or alerts on transitions. Would add a `notify` effect type.
- **Full SLA configuration** — clock pausing on awaiting states, configurable warning thresholds per SLA type.
- **Form definitions** — context-dependent task forms. Exercised by the [application review prototype](application-review-prototype.md) instead.
- **Alert rules** — operational alert thresholds (`ruleType: alert`).
- **Skill matching strategies** — `round_robin`, `least_loaded`, `skill_match` assignment actions.
- **Task type configuration** — `TaskType` lookup with default SLA, priority, and required skills.

---

## Behavioral Contract Tables

A behavioral contract is composed of these table types. Each is authored in a spreadsheet and converted to YAML by scripts.

| Table type | What it defines | Example |
|---|---|---|
| **State transition table** | Valid states, transitions, and which guards and effects apply to each | `pending` → `in_progress` via `claim`, guarded by "task is unassigned" |
| **Guards catalog** | Named preconditions with field, operator, and value | `callerIsAssignedWorker`: `assignedToId` equals `$caller.id` |
| **Effects catalog** | Named operations — what they do, what object they target, field mappings | `create_task`: creates a `task`, maps `programType` from source |
| **Decision tables** | Rule sets evaluated against an object — first match wins | If `programType` = SNAP → route to `snap-intake` queue |
| **Metrics table** | What to measure, source type (duration, count, state), and targets | `task_time_to_claim`: p95 < 4 hours |
| **Audit requirements** | What every transition must produce | Every transition creates a `TaskAuditEvent` with `taskId`, `eventType`, `performedById`, `occurredAt` |

The state transition table is the backbone — it references guards and effects by name. The catalogs define what those names mean. Decision tables are invoked by effects (e.g., `evaluate-rules`). Metrics and audit requirements are cross-cutting declarations validated against the state machine.

---

## OpenAPI Schemas

These are the REST API schemas for the prototype. The adapter exposes standard CRUD endpoints for each (`GET /workflow/tasks`, `POST /workflow/tasks`, `GET /workflow/tasks/:id`, etc.).

### Task

| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Unique identifier |
| status | enum | `pending`, `in_progress`, `completed` |
| priority | enum | `expedited`, `high`, `normal`, `low` |
| taskTypeCode | string | Reference to task type (e.g., `verify_income`, `eligibility_determination`) |
| programType | string | Program (e.g., `snap`, `medicaid`, `tanf`) |
| isExpedited | boolean | Whether this task qualifies for expedited processing |
| assignedToId | uuid | Reference to assigned caseworker (null when unassigned) |
| queueId | uuid | Reference to Queue (set by assignment rules) |
| requiredSkills | string[] | Skills needed to work this task |
| applicationId | uuid | Reference to application (optional) |
| caseId | uuid | Reference to case (optional) |
| slaTypeCode | string | Reference to SLAType (e.g., `snap_standard`, `snap_expedited`) |
| dueDate | datetime | SLA deadline (computed from SLAType on creation) |
| slaInfo | object | SLA tracking — `slaStatus` (`on_track`, `at_risk`, `breached`), `clockStartDate`, `slaDeadline` |
| outcomeInfo | object | Completion details — `outcome` (string), `notes` (string). Set on complete. |
| createdAt | datetime | Creation timestamp |
| updatedAt | datetime | Last update timestamp |

### Queue

| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Unique identifier |
| name | string | Display name (e.g., "SNAP Intake") |
| programType | string | Associated program |
| status | enum | `active`, `inactive` |

### SLAType

Configuration record looked up on task creation to calculate deadlines.

| Field | Type | Description |
|-------|------|-------------|
| code | string | Primary key (e.g., `snap_standard`, `snap_expedited`) |
| programType | string | Program this SLA applies to |
| durationDays | integer | Days until deadline (e.g., 30, 7) |
| warningThresholdDays | integer | Days before deadline to flag as `at_risk` |

### TaskAuditEvent

| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Unique identifier |
| taskId | uuid | Reference to Task |
| eventType | string | `created`, `assigned`, `returned_to_queue`, `completed` |
| previousValue | string | Previous state |
| newValue | string | New state |
| performedById | uuid | Who performed the action |
| reason | string | Why the action was taken (optional — e.g., release reason) |
| occurredAt | datetime | When the event occurred |

### TaskClaimedEvent

Event payload emitted when a task is claimed. Included to exercise the event contract pattern — other transitions would follow the same approach.

| Field | Type | Description |
|-------|------|-------------|
| taskId | uuid | The claimed task |
| claimedById | uuid | The worker who claimed it |
| queueId | uuid | The queue it was claimed from |
| claimedAt | datetime | When the claim occurred |

---

## State Transition Table

This table defines the task lifecycle as a state machine. Each row is a valid transition — the trigger becomes an RPC API endpoint (e.g., `claim` → `POST /workflow/tasks/:id/claim`). The adapter rejects transitions from invalid states with a 409 response. The conversion script generates the state machine YAML from this table.

| From State | To State | Trigger | Who | Guard | Effects |
|------------|----------|---------|-----|-------|---------|
| *(creation)* | pending | — | supervisor, system | — | Look up SLA deadline from SLAType, evaluate routing rules, create audit event |
| pending | in_progress | claim | caseworker | Task is unassigned; worker has required skills | Assign task to worker, create audit event, emit task.claimed event |
| in_progress | completed | complete | caseworker | Caller is the assigned worker | Record outcome, create audit event; if follow-up requested, create new task (copies `programType`, `slaTypeCode`, `applicationId`, `caseId` from original) |
| in_progress | pending | release | caseworker | Caller is the assigned worker | Clear assignment, create audit event, re-evaluate routing rules |

The *(creation)* row is not a state transition — it's an `onCreate` block, a domain-specific extension to the base state machine schema. Object creation has no "from" state, but often requires orchestration (SLA calculation, routing, audit). Domains extend the base schema with top-level fields like `onCreate` as requirements emerge — see [How the Contracts Work](../architecture/contract-driven-architecture.md#how-the-contracts-work).

**SLA clock behavior by state:**

| State | SLA Clock |
|-------|-----------|
| pending | running |
| in_progress | running |
| completed | stopped |

### Guards

Guards are conditions that must be true for a transition to fire. The transition table uses plain English; developers define the actual field comparisons in the state machine YAML.

| Guard (from table) | Field | Operator | Value |
|---------------------|-------|----------|-------|
| Task is unassigned | `assignedToId` | is null | — |
| Worker has required skills | `$caller.skills` | contains all | `$object.requiredSkills` |
| Caller is the assigned worker | `assignedToId` | equals | `$caller.id` |

`$caller` refers to the authenticated user (from JWT claims in production, headers in the mock server). `$object` refers to the task being acted on.

### Effects

Effects are side effects that must occur when a transition fires. The transition table uses plain English; developers define the structured operations in the state machine YAML.

**Effect types used in this prototype:**

| Effect type | What it does | Example |
|-------------|-------------|---------|
| `set` | Update fields on the task | Set `assignedToId` to `$caller.id` on claim |
| `create` | Create a record in another collection | Create a `TaskAuditEvent` with taskId, eventType, performedById, occurredAt |
| `lookup` | Retrieve a value from another entity and bind it for use in subsequent effects | Look up `SLAType` by task's `slaTypeCode` to get deadline duration |
| `evaluate-rules` | Invoke the rules engine | Evaluate assignment and priority rules on create and release |
| `event` | Emit a domain event with a typed payload | Emit `task.claimed` with `TaskClaimedEvent` payload on claim |

Any effect can include a **`when` clause** to make it conditional on a runtime value. This is not a separate effect type — it's a modifier on any of the types above. Example: `create: Task` with `when: $request.createFollowUp == true` only creates the follow-up task when the caller requests it.

**How effects map to each transition:**

| Trigger | set | create | lookup | evaluate-rules | event |
|---------|-----|--------|--------|----------------|-------|
| *(creation)* | `dueDate`, `slaInfo` (from SLA lookup) | TaskAuditEvent (`created`) | SLAType (for deadline) | Assignment + priority rules | — |
| claim | `assignedToId` = `$caller.id` | TaskAuditEvent (`assigned`) | — | — | `task.claimed` → TaskClaimedEvent |
| complete | `outcomeInfo` from `$request` | TaskAuditEvent (`completed`); Task (`when: $request.createFollowUp`) | — | — | — |
| release | `assignedToId` = null | TaskAuditEvent (`returned_to_queue`, reason: `$request.reason`) | — | Re-evaluate routing rules | — |

`$request` refers to the request body sent with the action.

### Cross-object effect wiring

Some effects create objects that are governed by their own behavioral contracts. For example, the `submit` transition on an `application` might fire a `create_task` effect, and that task is then governed by the task state machine and routed by the `routing_rules` decision table. The state machine table stays clean — it just says `create_task`. But the mock server needs to know what object to create, what fields to map from the source, and what behavioral contracts apply to the result.

This is a well-established problem. The industry standard approach separates it into layers:

- **BPMN** uses **Service Tasks** for object creation and **Business Rule Tasks** for decision table invocation. Each task declares its inputs and outputs explicitly — what data flows in from the source object and what flows out to the next step. The cross-object wiring lives in the process definition, not in the state machine or decision table.
- **DMN** decision tables are stateless and side-effect free by design. They receive inputs and return outputs. The caller is responsible for wiring the output (e.g., a queue assignment) to the target object.
- **Temporal** and similar workflow engines use **child workflows** — a parent workflow spawns a child with explicit data passed at creation time.

The common pattern: **the cross-object wiring lives in the effects catalog, not in the state machine or decision table.** The state table says *what* to do (`create_task`, `evaluate_routing_rules`). The effects catalog says *how* — including the target object type, field mappings from source to target, and which behavioral contracts to invoke on the result.

For the blueprint, this means each effect in the catalog declares:

- **target** — what object type it produces or acts on (e.g., `create_task` → `task`)
- **mapping** — what fields flow from the source object to the target (e.g., `programType`, `slaTypeCode`, `applicationId` from the application to the task)
- **triggers** — what behavioral contracts apply to the created object (e.g., the task's `onCreate` block evaluates `routing_rules`)

This keeps the state machine table analyst-readable while giving the mock server enough information to chain effects across objects. A developer registers the effect and its wiring; an analyst composes effects into transition rows without needing to understand the plumbing.

> **Open question (issues [#84](https://github.com/codeforamerica/safety-net-blueprint/issues/84), [#85](https://github.com/codeforamerica/safety-net-blueprint/issues/85)):** The exact schema for the effects catalog — how target, mapping, and triggers are declared in YAML — is not yet defined. The prototype's `create` effect type (which creates TaskAuditEvents within the same domain) is the simplest case. Cross-domain object creation (application → task) will require the catalog to declare the full wiring.

### Request bodies

Each RPC API endpoint accepts a JSON request body.

| Trigger | Endpoint | Request body fields |
|---------|----------|-------------------|
| claim | `POST /workflow/tasks/:id/claim` | *(none — caller identity comes from auth context)* |
| complete | `POST /workflow/tasks/:id/complete` | `outcome` (string), `notes` (string, optional), `createFollowUp` (boolean, optional) |
| release | `POST /workflow/tasks/:id/release` | `reason` (string) |

---

## Decision Tables

These tables define the routing and priority rules. Each row is a rule evaluated against the task. The conversion script generates the rules YAML from these tables.

**Context variables available to rules:**
- `task.*` — Task fields (`programType`, `taskTypeCode`, `isExpedited`, `dueDate`, etc.). The state machine binds the governed entity as the context object — in the workflow domain, this is the task. See [Rules](../architecture/contract-driven-architecture.md#rules).

Cross-domain context (e.g., `application.*` for household data) is not included in this prototype. Rules that need application data would be added when the context binding system is built.

### Assignment Rules

Rules that determine which queue a task is routed to. Evaluated in order — first match wins.

| # | task.programType | Action | Target Queue | Fallback Queue |
|---|-----------------|--------|-------------|----------------|
| 1 | SNAP | Assign to queue | snap-intake | general-intake |
| 2 | any | Assign to queue | general-intake | — |

### Priority Rules

Rules that set task priority. Evaluated in order — first match wins.

| # | Condition | Priority |
|---|-----------|----------|
| 1 | `task.isExpedited` is true | expedited |

**How rules connect to the state machine:** The `onCreate` effects include `evaluate-rules`, which invokes the rules engine with the tables above. The `release` trigger also re-evaluates routing rules, since a released task may need to go to a different queue.

---

## Metrics Summary

These metrics define what to measure for operational monitoring. Each metric exercises a different source type from the [metrics artifact](../architecture/contract-driven-architecture.md#how-the-contracts-work).

| Metric | What It Measures | Source type | Source | Target |
|--------|-----------------|-------------|--------|--------|
| task_time_to_claim | Time from creation to first claim | Duration (from/to) | `pending` → `in_progress` (claim trigger) | p95 < 4 hours |
| tasks_in_queue | Tasks waiting to be claimed | State count | Count of tasks in `pending` state | Trend down |
| release_rate | Rate of tasks being released back to queue | Transition count | `release` transition count / total transitions | < 10% |

---

## Audit Requirements

Every transition and the `onCreate` effects must produce a `TaskAuditEvent` record. The validation script verifies this — if a transition is missing a `create: TaskAuditEvent` effect, validation fails.

| Requirement | Value |
|-------------|-------|
| Audit entity | TaskAuditEvent |
| Scope | All transitions + onCreate |
| Required fields | `taskId`, `eventType`, `performedById`, `occurredAt` |
