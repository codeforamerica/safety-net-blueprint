# Workflow Domain

The Workflow domain manages the lifecycle of caseworker tasks — the discrete units of work generated during benefits processing. This document covers the domain model, task lifecycle, SLA tracking, domain events, and the design decisions behind them. Systems compared: Atlassian Jira Service Management (JSM), ServiceNow, IBM Cúram, Salesforce Government Cloud, Pegasystems (Pega), Appian, Camunda, WS-HumanTask. Regulatory standards: 7 CFR Part 273 (SNAP), 42 CFR Part 435 (Medicaid/MAGI).

## Overview

The Workflow domain owns task creation, assignment, state transitions, SLA tracking, and the domain events that drive cross-domain coordination. It does not determine eligibility, manage case data, or send notices — those are downstream domain concerns that subscribe to workflow events.

The primary object is the **Task** — a unit of work assigned to a caseworker, supervisor, or automated process. Tasks move through an explicit lifecycle governed by a state machine, carry deadline tracking via SLA types, and route to **Queues** that control caseworker visibility and workload distribution. All major platforms have equivalent concepts: task/work item, queue/team, and SLA/deadline tracking.

## What happens during case processing

1. When a triggering event occurs — such as an application being submitted — a caseworker task is created and assigned to the appropriate queue. The regulatory processing clock starts at this point.
2. The task is routed to a queue based on program type, geography, workload, and agency rules. Routing logic is fully replaceable per state.
3. A caseworker claims the task from the queue and begins active work.
4. The caseworker reviews submitted data, conducts required interviews, and requests and reviews documents.
5. If the caseworker is waiting for a client response or a third-party verification result, the task enters a waiting state. Client-caused delays are excluded from the agency's processing clock under federal regulations. (7 CFR § 273.2)
6. For SNAP, the agency must determine within 1 business day whether the household qualifies for the 7-day expedited track. If so, the task is moved to a higher-priority SLA track. (7 CFR § 273.2(i))
7. When a deadline approaches or supervisor involvement is needed, the task is escalated. Escalation does not pause the regulatory clock — the deadline continues running.
8. For determinations requiring supervisor sign-off, the caseworker submits the task for supervisor review. The supervisor either approves completion or returns the task for revision. (7 CFR § 275)
9. The task is marked complete. Downstream domains are notified and react accordingly.

## Regulatory requirements

### Processing deadlines

Federal law sets maximum processing timelines that begin at application receipt, not when a caseworker claims the task.

| Program | Deadline | Citation | Notes |
|---|---|---|---|
| SNAP standard | 30 calendar days | 7 CFR § 273.2(g)(1) | From application receipt date |
| SNAP expedited | 7 calendar days | 7 CFR § 273.2(i) | For households meeting expedited criteria |
| Medicaid standard | 45 calendar days | 42 CFR § 435.912 | From application receipt date |
| Medicaid disability | 90 calendar days | 42 CFR § 435.912(b) | When a disability determination is required |

### Quality control requirements

SNAP requires federal quality control audits that review a sample of cases each year. Determinations must be documented and, in many states, supervisor-reviewed before finalization. (7 CFR § 275) Medicaid has a parallel QC framework. (42 CFR Part 431, Subpart F) The workflow domain supports structured supervisor sign-off as a first-class lifecycle state to satisfy these requirements.

## Entity model

### Task

A task is the atomic unit of caseworker activity — reviewing an application, verifying a document, completing a redetermination. It represents a single, ownable piece of work with a clear beginning and end.

Key fields:
- `status` — the current lifecycle state; see [Decision 1](#decision-1-task-state-is-explicit-not-derived)
- `assignedToId` — the caseworker currently responsible; null when the task is unassigned and in a queue
- `subjectType` / `subjectId` — polymorphic link to the record the task is about (application, case, document); see [Decision 7](#decision-7-guards-on-tasktype-enable-multiple-lifecycles-per-state-machine)
- `taskType` — discriminator for task-type-specific lifecycle branches (e.g., fair hearing tasks alongside standard casework)
- `queueId` — the queue the task is routed to; determines caseworker visibility
- `priority` — numeric processing urgency (1=expedited, 2=high, 3=normal, 4=low); lower number = higher urgency; see [Decision 9](#decision-9-numeric-integer-priority)
- `isExpedited` — whether the household qualifies for the expedited SNAP track; when true, `setPriority` sets `priority` to 1
- `slaInfo` — array of per-SLA-type deadline tracking entries; see [SLA and deadline management](#sla-and-deadline-management)
- `blockedAt` — timestamp set when the task enters an awaiting state; cleared on resume; the SLA engine uses this to calculate excluded time
- `escalatedAt` — timestamp set when the task is escalated; preserved through de-escalation for audit

All major platforms have an equivalent task/work item concept with explicit ownership, status, and deadline tracking.

### Queue

A queue is a named pool of tasks, typically organized by program type, team, or skill level. Tasks route to a queue automatically when created or released. Supervisors manage queues to balance workload.

Key fields:
- `name` — logical identifier used by routing rules (e.g., `snap-intake`, `general-intake`)
- Queue membership is determined dynamically by routing rules at claim time — workers are not members of a queue in a static sense

Queue definitions are deployment-time configuration, not runtime data. See [Decision 19](#decision-19-queue-definitions-in-workflow-configyaml).

### SLA types

Each task carries one `slaInfo` entry per applicable SLA type, tracking deadline status in real time. SLA types define the duration, warning threshold, and the conditions under which the clock pauses and resumes. Multiple types can apply simultaneously — a SNAP task may acquire both a standard and expedited deadline. See [Decision 13](#decision-13-multiple-sla-types-can-apply-per-task).

Baseline SLA types derived from federal regulations:

| SLA type | Duration | Warning threshold | Pauses when |
|---|---|---|---|
| `snap_expedited` | 7 days | 75% elapsed | `awaiting_client` or `awaiting_verification` |
| `snap_standard` | 30 days | 75% elapsed | `awaiting_client` or `awaiting_verification` |
| `medicaid_standard` | 45 days | 75% elapsed | `awaiting_client` or `awaiting_verification` |
| `medicaid_disability` | 90 days | 75% elapsed | `awaiting_client` or `awaiting_verification` |

### Metrics

Operational metrics give supervisors visibility into queue health, team performance, and compliance risk. Each metric is defined declaratively as a YAML contract artifact — specifying what data to query, how to aggregate it, and what performance target to evaluate against. See [Decision 16](#decision-16-metrics-as-yaml-contract-artifacts).

## Task lifecycle

### States

| State | SLA clock | Description |
|---|---|---|
| `pending` | running | In queue awaiting caseworker claim |
| `in_progress` | running | Claimed; actively being worked |
| `awaiting_client` | paused | Waiting for client response; federal regulations exclude this time from the agency's deadline. See [Decision 2](#decision-2-awaiting_client-and-awaiting_verification-as-separate-first-class-states) |
| `awaiting_verification` | paused | Waiting for a third-party verification result. See [Decision 2](#decision-2-awaiting_client-and-awaiting_verification-as-separate-first-class-states) |
| `escalated` | running | Elevated for supervisor attention; agency deadline continues running |
| `pending_review` | running | Submitted for supervisor sign-off before completion. See [Decision 3](#decision-3-pending_review-as-a-dedicated-supervisor-sign-off-state) |
| `completed` | stopped | Work finished |
| `cancelled` | stopped | Task abandoned; supervisors can reopen |

All states have an explicit `slaClock` value — the schema requires it with no default to prevent silent regressions when new states are added. See [Decision 10](#decision-10-slaclock-required-on-every-state).

### Key transitions

- **`claim`**: `pending` → `in_progress` — caseworker takes ownership from the queue; sets `assignedToId`
- **`await-client`**: `in_progress` → `awaiting_client` — caseworker waiting on client; pauses SLA clock
- **`await-verification`**: `in_progress` → `awaiting_verification` — caseworker waiting on third-party data; pauses SLA clock
- **`resume`**: `awaiting_*` → `in_progress` — caseworker resumes after receiving external input; clock resumes
- **`auto-resume`**: `awaiting_verification` → `in_progress` — automated callback from a verification service; see [Decision 6](#decision-6-automated-verification-uses-a-dedicated-system-triggered-trigger)
- **`escalate`**: `pending` | `in_progress` → `escalated` — caseworker or supervisor escalates; re-evaluates priority via `setPriority`
- **`de-escalate`**: `escalated` → `pending` — supervisor resolves escalation; returns to queue for re-claim
- **`submit-for-review`**: `in_progress` → `pending_review` — caseworker requests supervisor sign-off
- **`approve`**: `pending_review` → `completed` — supervisor approves
- **`return-to-worker`**: `pending_review` → `in_progress` — supervisor returns for revision; task stays with same caseworker
- **`complete`**: `in_progress` → `completed` — caseworker marks work done without supervisor review
- **`cancel`**: `pending` | `in_progress` | `escalated` → `cancelled` — supervisor only; see [Decision 5](#decision-5-cancel-is-supervisor-only-no-notify-effect)
- **`reopen`**: `cancelled` → `pending` — supervisor reinstates; clears assignment for fresh routing
- **`set-priority`**: any active state — supervisor manually overrides priority

Timer-triggered transitions fire automatically when durations elapse. See [Decision 4](#decision-4-calendartype-is-explicit-per-timer-transition).

### Reactive behavior

Task creation and field-change reactions are handled via event subscriptions in the state machine's `events:` block, not special lifecycle hooks. When a task is created, `assignToQueue` and `setPriority` run and initial timers are scheduled. When `isExpedited` or `programType` change via PATCH, priority is re-evaluated. Transition-internal field changes do not trigger the update subscription.

## SLA and deadline management

Each task carries one `slaInfo` record per applicable SLA type. The baseline types are derived from federal regulatory deadlines. See [Decision 12](#decision-12-sla-type-definitions-are-independently-replaceable) for why they live in a separate file, [Decision 13](#decision-13-multiple-sla-types-can-apply-per-task) for multiple simultaneous deadlines, [Decision 14](#decision-14-pausewhenresumewhen-per-sla-type) for per-type pause conditions.

## Domain events

Every state machine transition emits an immutable domain event. Events are the audit trail required by federal QC regulations and the integration surface for cross-domain coordination — other domains subscribe to workflow events rather than polling task state. See [Decision 15](#decision-15-the-audit-trail-is-immutable).

### Event catalog

| Event | Why it's needed | Trigger | Primary consumers |
|---|---|---|---|
| `task.claimed` | Signals a caseworker has taken ownership; downstream domains open associated records | `claim` transition | Intake |
| `task.completed` | Signals casework is finished | `complete` or `approve` | Case management, communications |
| `task.cancelled` | Signals the task will not be completed; downstream domains should cancel associated work | `cancel` | Intake, communications |
| `task.escalated` | Signals supervisor attention is needed | `escalate` | Supervisors, operational dashboards |
| `task.priority_changed` | Records priority overrides for audit and dashboard refresh | `set-priority` | Operational dashboards |
| `task.sla_breached` | Signals a regulatory deadline has passed | SLA timer | Supervisors, compliance reporting |

## Contract artifacts

| Artifact | File |
|---|---|
| OpenAPI spec | `workflow-openapi.yaml` — Tasks, Queues, Events, Metrics |
| State machine | `workflow-state-machine.yaml` — States, transitions, guards, steps |
| Rules | `workflow-rules.yaml` — Assignment and priority procedures |
| SLA types | `workflow-sla-types.yaml` — Baseline SLA types for SNAP and Medicaid |
| Metrics | `workflow-metrics.yaml` — Baseline operational metrics |
| Config | `workflow-config.yaml` — Queue catalog and deployment-time configuration |

## Key design decisions

| # | Decision | Summary |
|---|---|---|
| 1 | [Task state is explicit, not derived](#decision-1-task-state-is-explicit-not-derived) | State is a first-class stored field, changed only via named transitions |
| 2 | [`awaiting_client` and `awaiting_verification` as separate states](#decision-2-awaiting_client-and-awaiting_verification-as-separate-first-class-states) | Federal regulations treat client-caused and agency-caused delays differently |
| 3 | [`pending_review` as dedicated supervisor sign-off state](#decision-3-pending_review-as-a-dedicated-supervisor-sign-off-state) | QC regulations require structured approval before determination |
| 4 | [`calendarType` is explicit per timer transition](#decision-4-calendartype-is-explicit-per-timer-transition) | Regulatory deadlines are calendar days; staffing SLAs are business hours — conflating them produces incorrect enforcement |
| 5 | [`cancel` is supervisor-only; no `notify` effect](#decision-5-cancel-is-supervisor-only-no-notify-effect) | Cancellation has federal reporting implications; notification is a consumer concern |
| 6 | [Automated verification uses a dedicated system-triggered transition](#decision-6-automated-verification-uses-a-dedicated-system-triggered-trigger) | Keeps automated callbacks distinguishable from human actions in the audit trail |
| 7 | [Guards on `taskType` enable multiple lifecycles per state machine](#decision-7-guards-on-tasktype-enable-multiple-lifecycles-per-state-machine) | One API surface and shared infrastructure serving multiple task types |
| 8 | [Routing and priority procedures are independently replaceable](#decision-8-routing-and-priority-procedures-are-independently-replaceable) | Routing logic varies significantly across states |
| 9 | [Numeric integer priority](#decision-9-numeric-integer-priority) | Integer enables correct sort order; matches JSM, ServiceNow, IBM Cúram |
| 10 | [`slaClock` required on every state](#decision-10-slaclock-required-on-every-state) | No default prevents silent regressions when new states are added |
| 11 | [`awaiting_*` states pause the SLA clock](#decision-11-awaiting-states-pause-the-sla-clock) | Federal SNAP regulations treat client-caused delays as excluded time |
| 12 | [SLA type definitions are independently replaceable](#decision-12-sla-type-definitions-are-independently-replaceable) | Deadline values vary by program mix |
| 13 | [Multiple SLA types can apply per task](#decision-13-multiple-sla-types-can-apply-per-task) | A SNAP task may become expedited after creation — both deadlines apply |
| 14 | [`pauseWhen`/`resumeWhen` per SLA type](#decision-14-pausewhenresumewhen-per-sla-type) | Different SLA types can pause on different conditions |
| 15 | [The audit trail is immutable](#decision-15-the-audit-trail-is-immutable) | Federal QC reviews and fair hearings require an unaltered history |
| 16 | [Metrics as YAML contract artifacts](#decision-16-metrics-as-yaml-contract-artifacts) | Metric definitions are explicit, versionable, and portable |
| 17 | [Duration metrics via event pairs](#decision-17-duration-metrics-via-event-pairs) | New duration measurements can be defined without schema changes |
| 18 | [Pre-aggregation is an adapter-layer concern](#decision-18-pre-aggregation-is-an-adapter-layer-concern) | On-demand computation is simpler for the baseline; states add pre-aggregation in adapters |
| 19 | [Queue definitions in `workflow-config.yaml`](#decision-19-queue-definitions-in-workflow-configyaml) | Queues are deployment-time configuration, not runtime data |

---

### Decision 1: Task state is explicit, not derived

**Status:** Decided: B

**What's being decided:** Whether task state is stored as an explicit field or computed from timestamps and other conditions.

**Considerations:**
- Deriving state from timestamps is fragile — if `completedAt` is set but then cleared, the state is ambiguous; if a timer fires but the update fails, the state is silently wrong
- All major platforms store task state explicitly: JSM (`status`), ServiceNow (`state`), Pega (`pyStatusWork`), Appian (`status`), WS-HumanTask (explicit state enum)
- Explicit state is directly queryable and produces clean audit events on each transition

**Options:**
- **(A)** Derive state from timestamps and conditions
- **(B) ✓** Store state as an explicit first-class field, changed only via named transitions

---

### Decision 2: `awaiting_client` and `awaiting_verification` as separate first-class states

**Status:** Decided: B

**What's being decided:** Whether to model waiting conditions as a single `on_hold` state with sub-reasons, or as separate first-class states.

**Considerations:**
- Federal regulations treat client-caused delays and agency-caused delays differently for SLA accountability and regulatory reporting. (7 CFR § 273.2) Collapsing them into sub-reasons requires parsing sub-reason data to determine SLA behavior — fragile and easy to get wrong.
- ServiceNow collapses both into `on_hold` sub-reasons; first-class states enable distinct timer behavior and cleaner federal reporting without sub-reason parsing.

| Concept | Blueprint | JSM | ServiceNow | IBM Cúram |
|---|---|---|---|---|
| Waiting for client | `awaiting_client` | Waiting for Customer | On Hold / Awaiting Caller | Manual activity pending |
| Waiting for third-party | `awaiting_verification` | Pending | On Hold / Awaiting Evidence | Suspended process |

**Options:**
- **(A)** Single `on_hold` state with sub-reasons
- **(B) ✓** Separate `awaiting_client` and `awaiting_verification` states with distinct SLA clock behavior and distinct domain events

**Customization:** States can override `slaClock` per state via overlay — for example, treating client non-response as stopped rather than paused.

---

### Decision 3: `pending_review` as a dedicated supervisor sign-off state

**Status:** Decided: B

**What's being decided:** Whether supervisor approval before determination is a first-class lifecycle state or an ad-hoc step outside the state machine.

**Considerations:**
- SNAP and Medicaid QC regulations require supervisor approval before a determination is finalized in many states. (7 CFR § 275) Without a first-class state, this approval is invisible to the state machine — no SLA accountability, no audit event, no queue visibility.
- This is distinct from escalation: escalation is upward for help or urgency; `pending_review` is a structured approval gate before completion.
- JSM and ServiceNow both support approval states within workflows; Pega models these as approval shapes in the case lifecycle.

**Options:**
- **(A)** Ad-hoc approval step outside the state machine
- **(B) ✓** `pending_review` as a dedicated state; caseworker submits via `submit-for-review`; supervisor either approves (→ `completed`) or returns (→ `in_progress`); SLA clock keeps running

**Customization:** States where regulation explicitly excludes review time from the deadline can override `slaClock: paused` on `pending_review` via overlay.

---

### Decision 4: `calendarType` is explicit per timer transition

**Status:** Decided: B

**What's being decided:** How timer transitions express whether they use calendar days or business hours.

**Considerations:**
- Regulatory deadlines (SNAP 30-day, Medicaid 45-day) are calendar days. Staffing SLAs are typically business hours. Conflating the two produces incorrect enforcement and federal reporting errors.
- JSM, ServiceNow, and IBM Cúram all make this configurable per SLA definition rather than global.
- Setting the wrong type silently miscalculates deadlines — making it explicit and required prevents silent errors.

**Options:**
- **(A)** Global default calendar type, overridable
- **(B) ✓** `calendarType` is an explicit required field per timer transition: `calendar` for regulatory deadlines, `business` for staffing SLAs

Baseline timer transitions:

| Trigger | From | To | After | Relative to | Calendar type |
|---|---|---|---|---|---|
| `auto-escalate` | `pending` | `escalated` | 72h | `createdAt` | business |
| `auto-escalate-sla-warning` | `in_progress` | `escalated` | -48h | `slaDeadline` | calendar |
| `auto-escalate-sla-breach` | `pending`, `in_progress`, `escalated` | `escalated` | 0h | `slaDeadline` | calendar |
| `auto-cancel` | `awaiting_client` | `cancelled` | 30d | `blockedAt` | calendar |
| `auto-resume` | `awaiting_verification` | `in_progress` | 7d | `blockedAt` | calendar |

**Customization:** All durations are overlay points. `calendarType` can be overridden per transition.

---

### Decision 5: `cancel` is supervisor-only; no `notify` effect

**Status:** Decided: B

**What's being decided:** Two related decisions for `cancel`: who can trigger it, and whether the state machine should have a built-in notification side effect.

**Considerations:**
- Cancelling a benefits task has federal reporting and client appeal implications — caseworkers cannot cancel unilaterally. JSM, ServiceNow, and IBM Cúram all restrict cancellation to privileged roles.
- A `notify` effect type would couple the workflow domain to specific notification delivery mechanisms. States that need notifications should build notification services that subscribe to domain events — a decoupled model.

**Options:**
- **(A)** Allow caseworkers to cancel; include `notify` effect type
- **(B) ✓** `cancel` restricted to supervisors; no `notify` effect type — notification is handled by consumers of domain events

**Customization:** States wanting a worker-initiated cancellation request with supervisor approval can model this via a custom `request-cancel` state.

---

### Decision 6: Automated verification uses a dedicated system-triggered transition

**Status:** Decided: B

**What's being decided:** Whether automated callbacks from verification services use the same `resume` trigger as human caseworkers or a dedicated trigger.

**Considerations:**
- SNAP and Medicaid QC requirements distinguish automated callbacks from human caseworker actions in the audit trail. A separate trigger keeps domain events distinguishable and allows the request body to carry verification result data (source, result summary).
- A relaxed guard on the shared `resume` trigger would allow system actors to use it, but the resulting domain event would be indistinguishable from a human resuming the task.

**Options:**
- **(A)** Shared `resume` trigger, guarded to allow system actors
- **(B) ✓** Dedicated `auto-resume` trigger, guarded by `callerIsSystem`; produces a distinct `task.system_resumed` event

---

### Decision 7: Guards on `taskType` enable multiple lifecycles per state machine

**Status:** Decided: B

**What's being decided:** Whether task-type-specific states and transitions require separate state machine files and API resources, or can be expressed within a single state machine.

**Considerations:**
- Requiring a separate state machine and API resource per task type would fragment the API surface and duplicate shared infrastructure (queues, SLA tracking, domain events, assignment rules).
- Pega (`caseTypeID`), Salesforce (`RecordTypeId`), and JSM (issue type) all scope available operations within a single object type's API.
- Task-type-specific transitions carry a guard checking `$object.taskType`. Shared transitions (`cancel`, `set-priority`) carry no task type guard and apply to all types.

**Options:**
- **(A)** Separate state machine file and API resource per task type
- **(B) ✓** Task-type-specific states and transitions added to the baseline state machine and guarded on `$object.taskType`

**Customization:** States add task-type-specific transitions and guards via overlay.

---

### Decision 8: Routing and priority procedures are independently replaceable

**Status:** Decided: B

**What's being decided:** Whether routing and priority rules are embedded in the state machine or defined as separately replaceable procedures.

**Considerations:**
- Routing logic varies significantly across states — program mix, geography, workload balancing, and organizational structure all affect assignment rules. Entangling routing with lifecycle logic would make both harder to change independently.

| | JSM | ServiceNow | Pega | Appian |
|---|---|---|---|---|
| Routing rules | Automation rules | Assignment rules | Push + Pull (Get Next Work) | Automated Case Routing |
| Priority rules | Field automation | SLA-based priority | Urgency (1–100) | KPI-based |

**Options:**
- **(A)** Routing and priority logic embedded in the state machine
- **(B) ✓** Named procedures (`assignToQueue`, `setPriority`) defined in the state machine; states replace or overlay individual procedures independently

**Customization:** States replace or overlay individual procedures via the state machine overlay.

---

### Decision 9: Numeric integer priority

**Status:** Decided: B

**What's being decided:** How to represent task priority — as a string enum or a numeric integer — given that priority must sort correctly and drive the list endpoint default ordering.

**Considerations:**
- String enums sort alphabetically, which produces the wrong urgency order: `expedited`, `high`, `low`, `normal` — placing `low` above `normal`. This makes a priority-first default sort impossible without special-case handling.
- All major platforms use numeric priority with lower numbers indicating higher urgency:

| Platform | Priority scale | Representation |
|---|---|---|
| Atlassian JSM | 1 (Highest) to 5 (Lowest) | Integer |
| ServiceNow | 1 (Critical) to 4 (Low) | Integer |
| IBM Cúram | 1 (Highest) to 5 (Lowest) | Integer |
| Pega | Urgency 1–100 | Integer |
| Salesforce Government Cloud | 1 (High) to 3 (Low) | Integer |

- Numeric representation enables correct ascending sort: `ORDER BY priority ASC` returns expedited (1) tasks before normal (3) tasks without special cases.
- Hybrid formats like `P1_Expedited` sort correctly by string prefix, but lose numeric expressiveness (arithmetic, range comparisons) and match no major platform's pattern.

**Options:**
- **(A)** String enum (`expedited`, `high`, `normal`, `low`)
- **(B) ✓** Integer (1=expedited, 2=high, 3=normal, 4=low); lower number = higher urgency
- **(C)** Hybrid string (`P1_Expedited`, `P2_High`, etc.)

**Decision:** Integer (B). The list endpoint default sort is `priority,-createdAt` — ascending on priority surfaces the most urgent tasks first. The mapping is documented in the schema description field; UI layers map integers to labels.

---

### Decision 10: `slaClock` required on every state

**Status:** Decided: B

**What's being decided:** Whether `slaClock` has a default value or must be explicitly declared on every state.

**Considerations:**
- If `slaClock` had a default, new states added via overlay could silently inherit the wrong clock behavior — running when they should pause, or stopping when they should run.
- Requiring explicit declaration forces intentional choices and prevents silent regressions when states are added.

**Options:**
- **(A)** `slaClock` defaults to `running`
- **(B) ✓** `slaClock` is required on every state with no default; the schema enforces this

---

### Decision 11: `awaiting_*` states pause the SLA clock

**Status:** Decided: B

**What's being decided:** Whether waiting states use `slaClock: paused` or `slaClock: stopped`.

**Considerations:**
- Federal SNAP regulations treat client-caused delays as excluded time — not as time that resets the agency's clock. (7 CFR § 273.2(f)) `paused` means the clock resumes from where it left off, preserving the original deadline. `stopped` would grant a fresh deadline on each block/resume cycle, distorting federal reporting.

| Concept | Blueprint | JSM | ServiceNow | IBM Cúram |
|---|---|---|---|---|
| Pause SLA | `slaClock: paused` on waiting states | "Pending" status excludes from SLA | On Hold sub-reasons pause SLA | Process-level SLA tracking |
| Stop SLA | `slaClock: stopped` on terminal states | Resolved / Closed | Resolved / Closed | Process completed |

**Options:**
- **(A)** `slaClock: stopped` on waiting states — grants a fresh deadline on resume
- **(B) ✓** `slaClock: paused` on waiting states — clock resumes from the same point

**Customization:** States that treat client non-response as the client's time to spend can override `slaClock` via overlay.

---

### Decision 12: SLA type definitions are independently replaceable

**Status:** Decided: B

**What's being decided:** Whether SLA deadline values are embedded in the state machine or defined in a separate file.

**Considerations:**
- States with different program mixes need different deadline values. Embedding deadlines in the state machine would couple two concerns that change independently.
- JSM and ServiceNow store SLA definitions as separate database records, decoupled from workflow configuration.

**Options:**
- **(A)** SLA deadline values embedded in the state machine YAML
- **(B) ✓** SLA type definitions in `workflow-sla-types.yaml`, separately from the state machine, independently replaceable per state

**Customization:** States replace or extend SLA types via overlay.

---

### Decision 13: Multiple SLA types can apply per task

**Status:** Decided: B

**What's being decided:** Whether a task can have multiple active SLA deadlines simultaneously.

**Considerations:**
- A SNAP application initially filed as standard may later be determined to qualify for expedited processing. Both the 30-day standard and 7-day expedited deadlines then apply simultaneously.
- IBM Cúram's single-deadline-per-process model cannot express this without custom logic.
- JSM and ServiceNow both support multiple SLA records per work item.

**Options:**
- **(A)** One SLA deadline per task
- **(B) ✓** Each task carries one `slaInfo` entry per applicable SLA type; multiple can apply simultaneously

---

### Decision 14: `pauseWhen`/`resumeWhen` per SLA type

**Status:** Decided: B

**What's being decided:** Whether SLA clock pause/resume behavior is determined by a hardcoded state list or by per-SLA-type conditions.

**Considerations:**
- Different SLA types may need different pause behavior on the same state. A state might pause `snap_standard` but not `snap_expedited` during `awaiting_client`. A hardcoded state list cannot express this.
- ServiceNow's on-hold conditions work the same way — conditions are expressed per SLA definition, not as a global state list.
- Warning thresholds are expressed as a percentage of total SLA duration (75%) rather than a fixed offset, so they scale correctly across deadline lengths.

**Options:**
- **(A)** Global pause/resume state list shared across all SLA types
- **(B) ✓** `pauseWhen` and `resumeWhen` are conditions defined per SLA type, evaluated on every transition

**Customization:** `pauseWhen` conditions can be tightened or loosened per regulatory interpretation via overlay.

---

### Decision 15: The audit trail is immutable

**Status:** Decided: B

**What's being decided:** Whether events can be modified or deleted after they are written.

**Considerations:**
- Federal QC reviews and fair hearings depend on an unaltered history of who acted, when, and why. Allowing mutations would undermine the regulatory function of the record. (7 CFR § 275)
- All major platforms maintain read-only audit trails: JSM (issue history), ServiceNow (audit log), Camunda (history service).

**Options:**
- **(A)** Events are mutable via PATCH or DELETE
- **(B) ✓** Events are never POST'd, PATCH'd, or DELETE'd via the API after creation

---

### Decision 16: Metrics as YAML contract artifacts

**Status:** Decided: B

**What's being decided:** Whether metric definitions are expressed as contract artifacts or configured in a proprietary GUI.

**Considerations:**
- All major systems define metrics through proprietary GUIs — non-portable and not version-controlled. JSM (custom gadgets), ServiceNow (Performance Analytics), IBM Cúram (MIS reports), Salesforce (formula reports), Pega (Application Quality dashboards), Appian (Process HQ KPIs).
- Defining metrics as YAML artifacts makes measurement definitions explicit, versionable, and portable across state implementations.

**Options:**
- **(A)** Metric definitions in a proprietary GUI or database
- **(B) ✓** Metrics as YAML contract artifacts in `workflow-metrics.yaml`; each metric declares `collection`, `aggregate`, and optional JSON Logic `filter`

**Customization:** States replace or extend `workflow-metrics.yaml` via overlay.

---

### Decision 17: Duration metrics via event pairs

**Status:** Decided: B

**What's being decided:** Whether duration metrics are pre-computed task fields or defined declaratively as event-pair correlations.

**Considerations:**
- Pre-computing duration as a task field requires deciding in advance which event pairs define a measurement. Adding a new measurement requires a schema change.
- The declarative model — `from` event, `to` event, correlated by a `pairBy` field — lets authors define new measurements without schema changes.

**Options:**
- **(A)** Duration stored as pre-computed task fields
- **(B) ✓** Duration metrics defined via `from`/`to` event pairs correlated by a `pairBy` field

---

### Decision 18: Pre-aggregation is an adapter-layer concern

**Status:** Decided: B

**What's being decided:** Whether metrics are pre-aggregated on a schedule or computed on demand.

**Considerations:**
- ServiceNow and JSM pre-aggregate metrics on a schedule for performance. For the baseline — a development mock and contract definition — on-demand computation is simpler and always current.
- States building production implementations add pre-aggregation in their adapters; the metric definitions remain the same.

**Options:**
- **(A)** Pre-aggregate metrics on a schedule in the baseline
- **(B) ✓** On-demand computation from live data for the baseline; pre-aggregation is an adapter-layer optimization

---

### Decision 19: Queue definitions in `workflow-config.yaml`

**Status:** Decided: B

**What's being decided:** Whether the baseline queue catalog is seed data for the mock server or a deployment-time configuration artifact that states can overlay.

**Considerations:**
- All major vendors (JSM, ServiceNow, IBM Cúram, Appian, Salesforce Government Cloud) separate queue and category configuration from runtime case data. Queues are created by deployment, not by caseworkers at runtime.
- Seeding queues from mock server example YAML conflates test data with canonical deployment configuration — states have no overlay mechanism and must fork the file.

**Options:**
- **(A)** Queue catalog as mock server seed data
- **(B) ✓** Queue definitions in `workflow-config.yaml`, following the same artifact pattern as `workflow-sla-types.yaml`; config-managed entries are seeded on startup and cannot be deleted via API

**Customization:** States extend the queue catalog via overlay.

---

## Customization

### Baseline constraints

| Element | Reason | Decision |
|---|---|---|
| `status` field on Task | Required for state machine evaluation; removing it breaks transition enforcement | [Decision 1](#decision-1-task-state-is-explicit-not-derived) |
| `slaInfo` array on Task | Required for regulatory deadline tracking; removing it breaks SLA enforcement | [Decision 13](#decision-13-multiple-sla-types-can-apply-per-task) |
| `slaClock` on every state | Required to prevent silent SLA regressions when states are added | [Decision 10](#decision-10-slaclock-required-on-every-state) |
| Named transition endpoints | Required for audit trail integrity and guard enforcement | — |
| `awaiting_client` / `awaiting_verification` distinction | Required for correct federal SLA reporting — client-caused vs. agency-caused delays are treated differently | [Decision 2](#decision-2-awaiting_client-and-awaiting_verification-as-separate-first-class-states) |

### State machine

States can add transitions, extend guards, add steps to existing transitions, and add task-type-specific states via overlay. Task-type-specific transitions should be guarded on `$object.taskType` to scope them appropriately. See [Decision 7](#decision-7-guards-on-tasktype-enable-multiple-lifecycles-per-state-machine).

### Routing and priority rules

The `assignToQueue` and `setPriority` procedures are the primary overlay targets for routing behavior. States replace individual procedures without modifying lifecycle logic. The `first-match-wins` evaluation model is used — rules are evaluated in declaration order and the first match wins.

### SLA types

States replace or extend `workflow-sla-types.yaml` entirely. Baseline types are illustrative — SNAP and Medicaid deadline values may differ by state based on regulatory interpretation and program waivers. See [Decision 12](#decision-12-sla-type-definitions-are-independently-replaceable).

### Metrics

States replace or extend `workflow-metrics.yaml`. `targets` values can be overridden to reflect state-specific performance goals without changing metric definitions.

## Out of scope

| Capability | Domain | Notes |
|---|---|---|
| Eligibility rules and approval/denial decisions | Eligibility | Workflow tracks task progress; eligibility determines outcomes |
| Notice and letter generation | Communications | Communications domain subscribes to workflow events |
| Case data management | Case Management | Case Management owns case records; workflow tasks link to them via `subjectId` |
| Task notes and comments | Case Management | Notes belong on the case, not the task |
| Read access logging for PII/PHI | Platform (cross-cutting) | HIPAA access logging is a platform infrastructure concern |

## Capability coverage

### Workflow engine

| Capability | Industry standard | Blueprint status |
|---|---|---|
| State machine versioning | All major platforms handle in-flight task migration when definitions change (Pega case type versioning, ServiceNow flow versions) | **Adapter layer** — migration strategy depends on the adapter's persistence model |
| Multi-tier approval chains | Most platforms support L1 → L2 → director chains (Pega, ServiceNow, Appian) | **Partial** — one approval tier only; states add intermediate states via overlay |
| Parallel task processing | Fork/join for concurrent tasks on one case (ServiceNow, Pega, Appian, IBM Cúram) | **Not in scope** — parallel sub-tasks within a case are a Case Management concern |
| Task dependencies | Blocking one task on completion of another (ServiceNow, JSM, Pega) | **Planned** — see #195 |

### Routing and assignment

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Skill-based routing | Route to agents matching required skills (JSM, ServiceNow, Pega, Appian) | **Planned** — see #199 |
| Workload-based routing | Route to least-loaded agent (ServiceNow, Appian, Pega Get Next Work) | **Planned** — see #198 |
| Pull routing / Get Next Work | Worker requests their next best assignment (Pega) | **Planned** — see #196 |
| Delegation / out-of-office routing | Tasks redirect when caseworker is unavailable (JSM, ServiceNow, Pega, Appian) | **Planned** — see #188 |
| Bulk reassignment | Supervisor reassigns multiple tasks at once (JSM, ServiceNow, IBM Cúram) | **Planned** — see #183 |
| Weighted priority scoring | Multi-factor numeric scoring (Pega Urgency 1–100, ServiceNow urgency × impact) | **Planned** — see #200 |

### SLA and deadline management

| Capability | Industry standard | Blueprint status |
|---|---|---|
| SLA goal tier | Soft target separate from hard deadline — Goal / Deadline / Passed Deadline (Pega) | **Planned** — see #189 |
| Holiday calendar management | Agency-specific calendars excluding non-working days (JSM, ServiceNow, Pega) | **Planned** — required for correct regulatory deadline calculation; see #190 |
| SLA retroactive recalculation | Recalculate deadlines when attributes change after creation (ServiceNow, Pega, IBM Cúram) | **Planned** — see #191 |
| Deadline extensions | Formal extension process with documented justification (ServiceNow, IBM Cúram, Pega) | **Planned** — see #192 |

### Access control

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Field-level access control | Caseworkers see different fields than supervisors (all major platforms) | **Not in scope** — a cross-cutting RBAC platform concern |
| Confidential case handling | Restricted-access cases and need-to-know enforcement (IBM Cúram, ServiceNow, Salesforce) | **Not in scope** — a property of the case, owned by Case Management |

### Integration and events

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Real-time event streaming / webhooks | Push notifications to external subscribers (JSM webhooks, ServiceNow Event Management) | **Not in scope** — a cross-cutting platform concern |
| Notification on state change | Configurable push notifications on escalation, block, completion | **Not in scope** — handled by the Communications domain subscribing to workflow events |

### Reporting and analytics

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Operational reporting | Built-in reports on caseload, productivity, backlog (JSM, ServiceNow, Pega, Appian, IBM Cúram) | **Not in scope** — a reporting-domain concern; workflow metrics provide the raw data |
| Fair hearing / appeals tracking | Dedicated workflow with hearing date scheduling and statutory deadlines (IBM Cúram, Pega, ServiceNow) | **Planned** — depends on task type as lifecycle discriminator (#193) |

## References

- Regulatory: [7 CFR Part 273](https://www.ecfr.gov/current/title-7/subtitle-B/chapter-II/subchapter-C/part-273) (SNAP), [42 CFR Part 435](https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-C/part-435) (Medicaid)
- Standards: [BPMN 2.0](https://www.omg.org/spec/BPMN/2.0/), [WS-HumanTask](https://www.oasis-open.org/committees/tc_home.php?wg_abbrev=bpel4people), [OpenAPI 3.x](https://spec.openapis.org/oas/v3.1.0)
- Related docs: [Domain Design Overview](../domain-design.md), [Contract-Driven Architecture](../contract-driven-architecture.md), [Behavioral Contract DSL](../cross-cutting/behavioral-contract-dsl.md) (expression language, rule context, event subscriptions), [Case Management](case-management.md), [Scheduling](scheduling.md)
