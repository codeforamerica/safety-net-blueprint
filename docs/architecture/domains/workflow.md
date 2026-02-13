# Workflow Domain

> **Status: Work in progress** — Design not yet approved. The [workflow prototype](../../prototypes/workflow-prototype.md) proves a subset of these patterns (3 states, 3 transitions). Full domain design is pending review.

See [Domain Design Overview](../domain-design.md) for context and [Contract-Driven Architecture](../contract-driven-architecture.md) for the contract approach.

## Overview

The Workflow domain manages work items, tasks, SLA tracking, and task routing. It is a **behavior-shaped** domain — the task lifecycle involves state transitions, guards, effects, routing rules, and SLA enforcement, making it a natural fit for behavioral contracts.

| Entity | Purpose |
|--------|---------|
| **Task** | A work item requiring action |
| **Queue** | Organizes tasks by team, county, program, or skill |
| **SLAType** | Configuration for SLA deadlines by program and task type |
| **TaskType** | Configuration for task categories with default SLA and skills |
| **TaskAuditEvent** | Immutable audit trail |
| **VerificationTask** | Task to verify data (extends Task) |
| **VerificationSource** | External services/APIs for data validation |

### Tasks vs Cases

**Tasks** and **Cases** serve different purposes:

| | Task | Case |
|---|------|------|
| **Lifespan** | Short-lived (created → worked → completed) | Long-lived (spans years, multiple programs) |
| **Purpose** | A discrete unit of work with a deadline | The ongoing relationship with a client/household |
| **Examples** | Verify income, determine eligibility, send notice | The Smith household's SNAP and Medicaid participation |
| **Owned by** | Workflow domain | Case Management domain |

**Tasks can be linked at two levels:**

- **Application-level tasks**: Tied to a specific application (e.g., verify income for application #123, determine eligibility for a new SNAP application)
- **Case-level tasks**: Tied to the ongoing case, not a specific application (e.g., annual renewal review, case maintenance, quality audit)

Both `applicationId` and `caseId` are optional on a Task — a task will have one or both depending on context.

---

## Contract Artifacts

| Artifact | Status | Notes |
|----------|--------|-------|
| OpenAPI spec | Draft | REST APIs for tasks, queues, SLA types, task types, audit events. Prototype proves Task, Queue, SLAType, TaskAuditEvent, TaskClaimedEvent. |
| State machine YAML | Draft | Task lifecycle — states, transitions, guards, effects. Prototype proves 3 states (pending, in_progress, completed) and 3 transitions (claim, complete, release). |
| Rules YAML | Draft | Assignment and priority routing rules. Prototype proves 2 assignment rules + 1 priority rule. |
| Metrics YAML | Draft | Operational metrics. Prototype proves 3 metrics across 3 source types (duration, state count, transition count). |

See [Workflow Prototype](../../prototypes/workflow-prototype.md) for the proven subset with working examples.

---

## OpenAPI Schemas

These define the REST API surface — standard CRUD endpoints for each resource (`GET /workflow/tasks`, `POST /workflow/tasks`, `GET /workflow/tasks/:id`, etc.).

### Task

The core work item representing an action that needs to be completed.

```yaml
Task:
  properties:
    id: uuid
    taskTypeCode: string     # Reference to TaskType.code (e.g., "verify_income")
    status:
      - pending
      - in_progress
      - awaiting_client
      - awaiting_verification
      - awaiting_review
      - returned_to_queue       # Caseworker released task
      - completed
      - cancelled
      - escalated
    priority:
      - expedited      # 7-day SNAP, emergency
      - high           # Approaching deadline
      - normal         # Standard processing
      - low            # Deferred/backlog
    # Context: a task is linked to an application, a case, or both
    applicationId: uuid      # Reference to Application (Intake) - for application-level tasks
    caseId: uuid             # Reference to Case (Case Management) - for case-level tasks
    assignedToId: uuid       # Reference to CaseWorker (Case Management)
    queueId: uuid            # Reference to Queue
    officeId: uuid           # Reference to Office (Case Management)
    programType: enum
    isExpedited: boolean     # Whether this task qualifies for expedited processing
    requiredSkills: string[] # Skills needed to work this task
    dueDate: datetime        # SLA deadline
    slaTypeCode: string      # Reference to SLAType.code (e.g., "snap_expedited")
    slaInfo: TaskSLAInfo     # SLA tracking details (computed from slaTypeCode)
    sourceInfo: TaskSourceInfo  # What triggered this task
    parentTaskId: uuid       # For subtasks
    blockedByTaskIds: uuid[] # Dependencies
    outcomeInfo: TaskOutcomeInfo  # Completion details
    createdAt, updatedAt: datetime
```

### Queue

Organizes tasks into logical groupings for routing and monitoring.

```yaml
Queue:
  properties:
    id: uuid
    name: string                    # "SNAP Intake - County A"
    description: string
    queueType:
      - team                        # For a specific team
      - office                      # For a specific office/county
      - program                     # For a specific program
      - skill                       # For tasks requiring specific skills
      - general                     # Default/catch-all
    teamId: uuid                    # Optional: linked Team
    officeId: uuid                  # Optional: linked Office
    programType: enum
    requiredSkills: string[]        # Skills needed to work tasks in this queue
    isDefault: boolean              # Default queue for unassigned tasks
    priority: integer               # Queue processing priority (lower = higher priority)
    status:
      - active
      - inactive
      - paused                      # Temporarily not accepting new tasks
    createdAt, updatedAt: datetime
```

### TaskSLAInfo

SLA tracking details embedded in Task. The SLA type is referenced via `Task.slaTypeCode`.

```yaml
TaskSLAInfo:
  properties:
    slaDeadline: datetime
    clockStartDate: datetime
    clockPausedAt: datetime    # When paused (awaiting client)
    totalPausedDays: integer
    slaStatus:
      - on_track
      - at_risk
      - breached
      - paused
      - completed
    warningThresholdDays: integer  # Computed from SLAType config
```

### TaskAuditEvent

Immutable audit trail for task actions.

```yaml
TaskAuditEvent:
  properties:
    id: uuid
    taskId: uuid
    eventType:
      - created
      - assigned
      - reassigned
      - returned_to_queue
      - status_changed
      - priority_changed
      - queue_changed
      - note_added
      - due_date_changed
      - escalated
      - completed
      - cancelled
      - sla_warning
      - sla_breached
    previousValue: string
    newValue: string
    performedById: uuid
    systemGenerated: boolean
    notes: string
    occurredAt: datetime (readonly)
```

### VerificationSource

External services and APIs available for data validation.

```yaml
VerificationSource:
  properties:
    id: uuid
    name: string                # "IRS Income Verification", "ADP Employment", "State Wage Database"
    sourceType:
      - federal_agency          # IRS, SSA, DHS/SAVE
      - state_database          # State wage records, DMV
      - commercial_service      # ADP, Equifax, LexisNexis
      - financial_institution   # Banks (for asset verification)
    dataTypes: []               # What this source can verify: income, employment, identity, etc.
    integrationMethod:
      - realtime_api            # Real-time API call
      - batch                   # Batch file exchange
      - manual_lookup           # Manual lookup by worker
    trustLevel:
      - authoritative           # IRS, SSA - can override client-reported data
      - supplementary           # Supports but doesn't override
      - reference               # For comparison only
    status:
      - active
      - inactive
      - maintenance
    createdAt, updatedAt: datetime
```

### VerificationTask

Task to verify intake data — either for accuracy (data validation) or program requirements (program verification).

```yaml
VerificationTask:
  extends: Task
  properties:
    verificationType:
      - data_validation         # Is the intake data accurate?
      - program_verification    # Does it meet program requirements?
      - both                    # Satisfies both purposes
    # What's being verified (Intake reference)
    applicationId: uuid
    dataPath: string            # Path to specific data (e.g., "income[0].amount", "person[2].citizenship")
    reportedValue: string       # The value client reported
    # For data validation
    verificationSourceId: uuid  # Which external source to check
    sourceResult:
      matchStatus:
        - match
        - mismatch
        - partial_match
        - not_found
        - source_unavailable
      sourceValue: string       # Value returned from external source
      confidence: number        # Match confidence (0-100) if applicable
      retrievedAt: datetime
    # For program verification
    eligibilityRequestId: uuid  # Which eligibility request this is for
    verificationRequirementId: uuid  # Which program requirement applies
    documentIds: uuid[]         # Supporting documents submitted
    # Outcome
    outcome:
      - verified
      - not_verified
      - discrepancy_found
      - waived
      - pending_documentation
    resolution:                 # If discrepancy found
      - client_corrected
      - source_error
      - data_accepted
      - referred_for_review
    resolutionNotes: string
    verifiedAt: datetime
    verifiedById: uuid
```

### Configuration Schemas

#### TaskType

Defines the types of tasks that can be created. New task types can be added without schema changes.

```yaml
TaskType:
  properties:
    code: string (PK)           # "verify_income", "eligibility_determination"
    category:
      - verification
      - determination
      - communication
      - review
      - inter_agency
      - renewal
      - appeal
    name: string
    description: string
    defaultSLATypeCode: string  # Reference to SLAType.code
    defaultPriority: string
    requiredSkills: string[]
    isActive: boolean
```

**Example task types:**

| Code | Category | Name | Default SLA |
|------|----------|------|-------------|
| `verify_income` | verification | Verify Income | snap_standard |
| `verify_identity` | verification | Verify Identity | snap_standard |
| `eligibility_determination` | determination | Eligibility Determination | snap_standard |
| `expedited_screening` | determination | Expedited Screening | snap_expedited |
| `supervisor_review` | review | Supervisor Review | internal_review |
| `renewal_review` | renewal | Renewal Review | renewal_standard |
| `appeal_review` | appeal | Appeal Review | appeal_standard |

#### SLAType

Defines SLA configurations for different programs and task types.

```yaml
SLAType:
  properties:
    code: string (PK)           # "snap_expedited", "medicaid_standard"
    name: string                # "SNAP Expedited Processing"
    programType: enum
    durationDays: integer       # 7, 30, 45, etc.
    warningThresholdDays: integer  # Days before deadline to show warning
    pauseOnStatuses: string[]   # Task statuses that pause the clock
    isActive: boolean
```

**Example SLA types:**

| Code | Program | Duration | Warning |
|------|---------|----------|---------|
| `snap_standard` | snap | 30 days | 5 days |
| `snap_expedited` | snap | 7 days | 2 days |
| `medicaid_standard` | medicaid | 45 days | 7 days |
| `medicaid_disability` | medicaid | 90 days | 14 days |
| `tanf_standard` | tanf | 30 days | 5 days |
| `appeal_standard` | (any) | varies by state | 7 days |

---

## State Machine

The task lifecycle is defined as a state machine. Each transition trigger becomes an RPC API endpoint (e.g., `claim` → `POST /workflow/tasks/:id/claim`). The adapter rejects transitions from invalid states with a 409 response.

> The [workflow prototype](../../prototypes/workflow-prototype.md) proves the rows marked with **\***. The remaining transitions use the same effect types and patterns.

### State Transition Table

| From State | To State | Trigger | Who | Guard | Effects |
|------------|----------|---------|-----|-------|---------|
| *(creation)* | pending | — | supervisor, system | — | Look up SLA deadline from SLAType, evaluate routing rules, create audit event |
| pending | in_progress | claim **\*** | caseworker | Task is unassigned; worker has required skills | Assign task to worker, create audit event, emit task.claimed event |
| in_progress | completed | complete **\*** | caseworker | Caller is the assigned worker | Record outcome, create audit event; if follow-up requested, create new task |
| in_progress | pending | release **\*** | caseworker | Caller is the assigned worker | Clear assignment, create audit event, re-evaluate routing rules |
| in_progress | escalated | escalate | caseworker, supervisor | — | Assign to supervisor, create audit event, notify supervisor |
| in_progress | awaiting_client | await-client | caseworker | Caller is the assigned worker | Pause SLA clock, create audit event |
| in_progress | awaiting_verification | await-verification | caseworker, system | — | Pause SLA clock, create audit event |
| awaiting_client | in_progress | resume | caseworker, system | — | Resume SLA clock, create audit event |
| awaiting_verification | in_progress | resume | caseworker, system | — | Resume SLA clock, create audit event |
| escalated | in_progress | de-escalate | supervisor | — | Reassign to worker, create audit event |
| pending | cancelled | cancel | supervisor | — | Create audit event |
| in_progress | cancelled | cancel | supervisor | — | Create audit event |
| any | — | reassign | supervisor | — | Update assignment, create audit event |

### Guards

| Guard | Field | Operator | Value |
|-------|-------|----------|-------|
| Task is unassigned | `assignedToId` | is null | — |
| Worker has required skills | `$caller.skills` | contains all | `$object.requiredSkills` |
| Caller is the assigned worker | `assignedToId` | equals | `$caller.id` |

`$caller` refers to the authenticated user (from JWT claims). `$object` refers to the task being acted on.

### Effects

| Effect type | What it does | Example |
|-------------|-------------|---------|
| `set` | Update fields on the task | Set `assignedToId` to `$caller.id` on claim |
| `create` | Create a record in another collection | Create a `TaskAuditEvent` on every transition |
| `lookup` | Retrieve a value from another entity | Look up `SLAType` by `slaTypeCode` to compute deadline |
| `evaluate-rules` | Invoke the rules engine | Evaluate assignment and priority rules on create and release |
| `event` | Emit a domain event with a typed payload | Emit `task.claimed` with `TaskClaimedEvent` payload |
| `notify` | Send a notification (not yet in prototype) | Notify supervisor on escalation |

Any effect can include a **`when` clause** for conditional execution (e.g., `create: Task` with `when: $request.createFollowUp == true`).

### SLA Clock Behavior

| State | SLA Clock |
|-------|-----------|
| pending | running |
| in_progress | running |
| awaiting_client | paused |
| awaiting_verification | paused |
| escalated | running |
| completed | stopped |
| cancelled | stopped |

### Audit Requirements

Every transition and the `onCreate` effects must produce a `TaskAuditEvent` record. The validation script verifies this — if a transition is missing a `create: TaskAuditEvent` effect, validation fails.

| Requirement | Value |
|-------------|-------|
| Audit entity | TaskAuditEvent |
| Scope | All transitions + onCreate |
| Required fields | `taskId`, `eventType`, `performedById`, `occurredAt` |

---

## Rules

Routing and priority rules are defined as decision tables in the rules YAML artifact — not as CRUD entities. The state machine invokes rules via `evaluate-rules` effects on task creation and release. Rules use [JSON Logic](https://jsonlogic.com/) for conditions.

**Context variables available to rules:**
- `task.*` — Task fields (`programType`, `taskTypeCode`, `isExpedited`, `officeId`, `dueDate`, etc.)
- `application.*` — Application data (household, income, etc.) — requires cross-domain context binding, not yet in prototype
- `case.*` — Case data (if case-level task) — requires cross-domain context binding, not yet in prototype

### Assignment Rules

Rules that determine which queue a task is routed to. Evaluated in order — first match wins.

| # | Condition | Action | Target Queue | Fallback Queue |
|---|-----------|--------|-------------|----------------|
| 1 | `task.programType` == SNAP | Assign to queue | snap-intake | general-intake |
| 2 | `task.programType` == Medicaid | Assign to queue | medicaid-intake | general-intake |
| 3 | `task.programType` == TANF | Assign to queue | tanf-intake | general-intake |
| 4 | `task.taskTypeCode` in [appeal_review, hearing_preparation] | Assign to queue | appeals | general-intake |
| 5 | any | Assign to queue | general-intake | — |

> The prototype proves rules #1 and #5 (SNAP-specific routing + catch-all).

### Priority Rules

Rules that set task priority. Evaluated in order — first match wins.

| # | Condition | Priority |
|---|-----------|----------|
| 1 | `task.isExpedited` is true | expedited |
| 2 | `task.daysUntilDeadline` <= 5 | high |

> The prototype proves rule #1 (expedited flag).

**JSON Logic examples:**

```json
// Route SNAP tasks from County A to specific queue
{
  "and": [
    { "==": [{ "var": "task.programType" }, "snap"] },
    { "==": [{ "var": "task.officeId" }, "county-a-id"] }
  ]
}

// Expedite for households with children under 6 (requires application context)
{
  "<": [{ "var": "application.household.youngestChildAge" }, 6]
}
```

---

## Metrics

Metrics define what to measure for operational monitoring. Each metric's source references specific states or transitions in the state machine.

> The prototype proves one metric from each source type: duration, state count, and transition count.

### Task Metrics

| Metric | Description | Source Type | Source | Labels | Target |
|--------|-------------|------------|--------|--------|--------|
| `task_time_to_claim` | Time from creation to first claim **\*** | Duration | `pending` → `in_progress` (claim) | programType, priority | p95 < 4 hours |
| `task_completion_time` | Time from creation to completion | Duration | `pending` → `completed` | taskType, programType, priority | p95 < SLA |
| `task_wait_time` | Time task spends unassigned in queue | Duration | Time in `pending` state | queueId, programType | p95 < 4 hours |
| `tasks_in_queue` | Tasks waiting to be claimed **\*** | State count | Count in `pending` state | queueId, programType, priority | Trend down |
| `tasks_by_status` | Current task count by status | State count | Count per status | status, programType | N/A |

### SLA Metrics

| Metric | Description | Source Type | Source | Labels | Target |
|--------|-------------|------------|--------|--------|--------|
| `sla_breach_rate` | Percentage of tasks that breach SLA | Transition count | Transitions to `breached` slaStatus | slaTypeCode, programType | < 5% |
| `sla_at_risk_count` | Tasks currently at risk of SLA breach | State count | Count where slaStatus = `at_risk` | slaTypeCode, queueId | Alert threshold |

### Assignment Metrics

| Metric | Description | Source Type | Source | Labels | Target |
|--------|-------------|------------|--------|--------|--------|
| `release_rate` | Rate of tasks released back to queue **\*** | Transition count | `release` count / total transitions | queueId | < 10% |
| `reassignment_rate` | Rate of tasks being reassigned | Transition count | `reassign` count / total transitions | queueId, reason | < 10% |
| `escalation_rate` | Rate of tasks being escalated | Transition count | `escalate` count | escalationType, queueId | Monitor trend |

### Verification Metrics

| Metric | Description | Source Type | Source | Labels | Target |
|--------|-------------|------------|--------|--------|--------|
| `verification_success_rate` | External verification API success rate | Transition count | Successful verifications / total | sourceId, sourceType | > 99% |
| `verification_latency` | Time to receive verification response | Duration | `awaiting_verification` → `in_progress` | sourceId | p95 < 10s |
| `verification_match_rate` | Rate of matches vs mismatches | Transition count | match count / total verifications | sourceId, verificationType | Monitor trend |

### Alert Thresholds

| Condition | Threshold | Action |
|-----------|-----------|--------|
| SLA breach imminent | > 10 tasks at risk in queue | Page supervisor |
| Verification source down | Availability < 95% for 5 min | Enable manual fallback |
| Queue depth spike | > 2x normal volume | Alert capacity planning |
| Worker overload | > 40 active tasks per worker | Rebalance assignments |

---

## Key Design Questions

- **Verification workflow** — Should VerificationTask be a separate state machine or nested states within the main task lifecycle?
- **Cross-domain rule context** — How do rules reference `application.*` or `case.*` data? Requires context binding beyond `task.*`.
- **Batch operations** — How should bulk reassignment work? A `bulk-reassign` RPC trigger, or a batch REST endpoint?
- **Skill matching strategies** — How do `round_robin`, `least_loaded`, and `skill_match` assignment actions work as rule actions?
- **Notification effects** — What triggers notifications beyond escalation? SLA warnings? Assignment changes?

## Related Documents

| Document | Description |
|----------|-------------|
| [Workflow Prototype](../../prototypes/workflow-prototype.md) | Proven subset — 3 states, 3 transitions, 3 rules, 3 metrics |
| [Domain Design](../domain-design.md) | Workflow section in the domain overview |
| [Case Management](case-management.md) | Staff, teams, offices — closely related domain |
| [Contract-Driven Architecture](../contract-driven-architecture.md) | Contract artifacts and the adapter pattern |
