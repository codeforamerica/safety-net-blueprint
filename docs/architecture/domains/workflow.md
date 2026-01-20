# Workflow Domain

Detailed schemas for the Workflow domain. See [Domain Design Overview](../domain-design.md) for context.

## Overview

The Workflow domain manages work items, tasks, SLA tracking, and task routing.

| Entity | Purpose |
|--------|---------|
| **Task** | A work item requiring action |
| **Queue** | Organizes tasks by team, county, program, or skill |
| **WorkflowRule** | Defines automatic task routing and prioritization logic |
| **VerificationTask** | Task to verify data (extends Task) |
| **VerificationSource** | External services/APIs for data validation |
| **TaskSLAInfo** | SLA tracking details (embedded in Task) |
| **TaskAuditEvent** | Immutable audit trail |

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

Both `applicationId` and `caseId` are optional on a Task—a task will have one or both depending on context.

---

## Capabilities

| Capability | Supported By |
|------------|--------------|
| **Supervisor - Tasks** | |
| Create task manually | `POST /processes/workflow/tasks/create` |
| Reassign task to worker/queue | `POST /processes/workflow/tasks/reassign` |
| Set or change task priority | `POST /processes/workflow/tasks/reassign` (with priority) |
| Bulk reassign or reprioritize | `POST /processes/workflow/tasks/bulk-reassign` |
| Escalate task | `POST /processes/workflow/tasks/escalate` |
| **Supervisor - Cases** | |
| Assign worker to case | `POST /processes/case-management/workers/assign` |
| Transfer case to office/worker | `POST /processes/case-management/cases/transfer` |
| **Supervisor - Monitoring** | |
| Monitor task queues | `GET /queues`, `GET /tasks` (System APIs) |
| Monitor team workload | `GET /caseloads` (Case Mgmt System API) |
| Monitor deadlines and alerts | `GET /tasks?q=slaStatus:at_risk` (System API) |
| **Caseworker** | |
| Claim task from queue | `POST /processes/workflow/tasks/claim` |
| Complete task with outcome | `POST /processes/workflow/tasks/complete` |
| Release task to queue | `POST /processes/workflow/tasks/release` |
| Escalate task | `POST /processes/workflow/tasks/escalate` |
| Start verification | `POST /processes/workflow/verification/start` |
| Complete verification | `POST /processes/workflow/verification/complete` |
| **System/Automation** | |
| Create task on events | `POST /processes/workflow/tasks/create` |
| Route and prioritize by rules | `POST /processes/workflow/tasks/route` |
| Auto-verify data | `POST /processes/workflow/verification/start` |
| **Future** | |
| Forecast staffing needs | See [Future Considerations](../roadmap.md) |
| Run productivity/backlog reports | TBD |

**Notes:**
- Task creation is event-driven: triggered by application submission, eligibility determination, verification needs, etc.
- Case capabilities reference [Case Management](case-management.md) Process APIs; task capabilities reference Workflow Process APIs.
- Staff and organizational entities (CaseWorker, Office, Team, Caseload) are in the [Case Management domain](case-management.md).
- Workflow tracks *task state* changes. Case Management tracks *who* is assigned and assignment history.
- Auto-assign rules (`WorkflowRule`) live here; auto-assign data (Office, Caseload, Skills) lives in Case Management.

---

## Schemas

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
    programType: enum        # TODO: Standardize ProgramType enum across all schemas
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
    programType: enum               # TODO: Standardize ProgramType enum across all schemas
    requiredSkills: string[]        # Skills needed to work tasks in this queue
    isDefault: boolean              # Default queue for unassigned tasks
    priority: integer               # Queue processing priority (lower = higher priority)
    status:
      - active
      - inactive
      - paused                      # Temporarily not accepting new tasks
    createdAt, updatedAt: datetime
```

### WorkflowRule

Defines automatic task routing and prioritization logic. Uses [JSON Logic](https://jsonlogic.com/) for flexible, extensible conditions.

```yaml
WorkflowRule:
  properties:
    id: uuid
    name: string                    # "Route SNAP to County A", "Expedite households with children under 6"
    description: string
    ruleType:
      - assignment                  # Routes tasks to queues/teams/workers
      - priority                    # Sets task priority level
    evaluationOrder: integer        # Rule evaluation order (lower = evaluated first)
    isActive: boolean
    # Conditions - JSON Logic expression evaluated against task + application context
    conditions: object              # JSON Logic expression (see examples below)
    # Action - what happens when conditions match
    # For assignment rules:
    assignmentStrategy:
      - specific_queue              # Assign to targetQueueId
      - specific_team               # Assign to targetTeamId
      - round_robin                 # Distribute evenly across team/queue members
      - least_loaded                # Assign to worker with lowest caseload
      - skill_match                 # Match task requiredSkills to worker skills
    targetQueueId: uuid             # For specific_queue strategy
    targetTeamId: uuid              # For specific_team strategy
    fallbackQueueId: uuid           # If primary assignment fails
    # For priority rules:
    targetPriority:
      - expedited
      - high
      - normal
      - low
    createdAt, updatedAt: datetime
```

**JSON Logic Condition Examples:**

```json
// Route SNAP tasks from County A to specific queue
{
  "and": [
    { "==": [{ "var": "task.programType" }, "snap"] },
    { "==": [{ "var": "task.officeId" }, "county-a-id"] }
  ]
}

// Expedite for households with children under 6
{
  "<": [{ "var": "application.household.youngestChildAge" }, 6]
}

// High priority when deadline within 5 days
{
  "<=": [{ "var": "task.daysUntilDeadline" }, 5]
}

// Skill-based routing for appeals
{
  "in": [{ "var": "task.taskTypeCode" }, ["appeal_review", "hearing_preparation"]]
}
```

**Available context variables:**
- `task.*` - Task fields (taskTypeCode, programType, officeId, daysUntilDeadline, etc.)
- `application.*` - Application data (household, income, etc.)
- `case.*` - Case data (if case-level task)

### TaskSLAInfo

SLA tracking details embedded in Task. The SLA type is referenced via `Task.slaTypeCode`.

```yaml
TaskSLAInfo:
  properties:
    # Note: slaTypeCode is on Task, not here (avoids duplication)
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
      - returned_to_queue      # Caseworker released task
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

Task to verify intake data - either for accuracy (data validation) or program requirements (program verification).

```yaml
VerificationTask:
  extends: Task
  properties:
    # Inherits Task fields (id, status, priority, assignedToId, queueId, officeId, etc.)
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
      - client_corrected        # Client updated their reported data
      - source_error            # External source had incorrect data
      - data_accepted           # Accepted despite mismatch (with justification)
      - referred_for_review     # Escalated for supervisor review
    resolutionNotes: string
    verifiedAt: datetime
    verifiedById: uuid          # CaseWorker who completed verification
```

---

## Configuration Schemas

These schemas define configurable lookup data that can be extended without schema changes.

### TaskType

Defines the types of tasks that can be created. New task types can be added without schema changes.

```yaml
TaskType:
  properties:
    code: string (PK)           # "verify_income", "eligibility_determination"
    category:
      - verification            # Document/data verification tasks
      - determination           # Eligibility determination tasks
      - communication           # Client communication tasks
      - review                  # Supervisor/quality review tasks
      - inter_agency            # Inter-agency coordination tasks
      - renewal                 # Renewal/recertification tasks
      - appeal                  # Appeals processing tasks
    name: string                # "Verify Income", "Eligibility Determination"
    description: string
    defaultSLATypeCode: string  # Reference to SLAType.code
    defaultPriority: string     # Default priority for this task type
    requiredSkills: string[]    # Default skills needed
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

### SLAType

Defines SLA configurations for different programs and task types.

```yaml
SLAType:
  properties:
    code: string (PK)           # "snap_expedited", "medicaid_standard"
    name: string                # "SNAP Expedited Processing"
    programType: enum           # TODO: Standardize ProgramType enum across all schemas
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

## API Design Notes

### Batch Operations

For bulk task management during surges, the Task API should support batch operations:

```yaml
# Batch update endpoint
PATCH /tasks/batch
  requestBody:
    taskIds: uuid[]           # Tasks to update
    updates:
      assignedToId: uuid      # Reassign to this worker
      queueId: uuid           # Move to this queue
      priority: string        # Change priority
      status: string          # Change status
  responses:
    200:
      updated: integer        # Count of successfully updated tasks
      failed: TaskUpdateError[]  # Any failures
```

### Skill Matching

When using `skill_match` assignment strategy:
1. Task's `requiredSkills` are compared against CaseWorker's `skills`
2. Only workers with all required skills are considered
3. Among qualified workers, `least_loaded` logic is applied

---

## Process APIs

Process APIs orchestrate business operations by calling System APIs. They follow the pattern `POST /processes/{domain}/{resource}/{action}` and use `x-actors` and `x-capability` metadata.

See [API Architecture](../api-architecture.md) for the full Process API pattern.

### Task Lifecycle

| Endpoint | Actors | Description |
|----------|--------|-------------|
| `POST /processes/workflow/tasks/create` | supervisor, system | Create a new task (manual or event-triggered) |
| `POST /processes/workflow/tasks/claim` | caseworker | Claim an unassigned task from a queue |
| `POST /processes/workflow/tasks/complete` | caseworker | Complete a task with outcome |
| `POST /processes/workflow/tasks/release` | caseworker | Return a task to the queue |
| `POST /processes/workflow/tasks/reassign` | supervisor | Reassign a task to different worker/queue |
| `POST /processes/workflow/tasks/escalate` | caseworker, supervisor | Escalate a task to supervisor |
| `POST /processes/workflow/tasks/bulk-reassign` | supervisor | Reassign multiple tasks |

### Task Routing

| Endpoint | Actors | Description |
|----------|--------|-------------|
| `POST /processes/workflow/tasks/route` | system | Apply workflow rules to determine queue/assignment |

### Verification

| Endpoint | Actors | Description |
|----------|--------|-------------|
| `POST /processes/workflow/verification/start` | caseworker, system | Initiate external data verification |
| `POST /processes/workflow/verification/complete` | caseworker, system | Record verification result |

---

### Create Task

Create a new task, either manually by a supervisor or triggered by system events.

```yaml
POST /processes/workflow/tasks/create
x-actors: [supervisor, system]
x-capability: workflow

requestBody:
  taskType: string             # Type of task (verify_income, eligibility_determination, etc.)
  applicationId: uuid          # Associated application (optional)
  caseId: uuid                 # Associated case (optional)
  programType: string          # snap, medicaid, tanf
  priority: string             # expedited, high, normal, low (optional, can be set by rules)
  dueDate: datetime            # Explicit deadline (optional, can be calculated from SLA)
  requiredSkills: string[]     # Skills needed (optional)
  notes: string                # Context for the task
  sourceInfo:                  # What triggered this task
    sourceType: string         # application_submitted, determination_complete, manual, etc.
    sourceId: uuid             # ID of triggering entity
    sourceDomain: string       # intake, eligibility, case-management, etc.
  skipRouting: boolean         # If true, don't apply routing rules
  targetQueueId: uuid          # Direct assignment to queue (if skipRouting)
  targetWorkerId: uuid         # Direct assignment to worker (if skipRouting)

responses:
  201:
    task: Task                 # Created task
    assignment: Assignment     # If worker was assigned
    rulesApplied: string[]     # Routing/priority rules that matched

# Orchestrates:
# 1. Create Task with provided fields
# 2. Calculate SLA deadline based on taskType and programType
# 3. If not skipRouting, apply WorkflowRules for priority and queue
# 4. If rule assigns to worker, create Assignment
# 5. Create TaskAuditEvent (created)
# 6. Update Caseload if worker assigned
```

### Claim Task

Caseworker claims an unassigned task from a queue.

```yaml
POST /processes/workflow/tasks/claim
x-actors: [caseworker]
x-capability: workflow

requestBody:
  taskId: uuid               # Task to claim
  notes: string              # Optional claim notes

responses:
  200:
    task: Task               # Updated task with assignedToId set
    assignment: Assignment   # New assignment record

# Orchestrates:
# 1. Validate task is unassigned and in valid queue
# 2. Check worker has required skills (CaseWorker.skills)
# 3. Update Task.assignedToId, Task.status → in_progress
# 4. Create Assignment record
# 5. Create TaskAuditEvent (assigned)
# 6. Update Caseload for worker
```

### Complete Task

Caseworker completes a task with an outcome.

```yaml
POST /processes/workflow/tasks/complete
x-actors: [caseworker]
x-capability: workflow

requestBody:
  taskId: uuid               # Task to complete
  outcome: string            # Task-specific outcome
  notes: string              # Completion notes
  createFollowUp: boolean    # Whether to create follow-up task

responses:
  200:
    task: Task               # Task with status: completed
    followUpTask: Task       # If createFollowUp was true

# Orchestrates:
# 1. Validate task is assigned to requesting worker
# 2. Update Task.status → completed, Task.outcomeInfo
# 3. Create TaskAuditEvent (completed)
# 4. Update Caseload for worker
# 5. If createFollowUp, create new Task and route it
# 6. If task type requires notice, trigger notice generation
```

### Release Task

Caseworker returns a task to the queue (cannot complete it).

```yaml
POST /processes/workflow/tasks/release
x-actors: [caseworker]
x-capability: workflow

requestBody:
  taskId: uuid               # Task to release
  reason: string             # Why releasing (required)
  suggestedSkills: string[]  # Skills needed to complete

responses:
  200:
    task: Task               # Task with status: returned_to_queue

# Orchestrates:
# 1. Validate task is assigned to requesting worker
# 2. Update Task.status → returned_to_queue, clear assignedToId
# 3. Optionally update Task.requiredSkills
# 4. Update Assignment.status → reassigned
# 5. Create TaskAuditEvent (returned_to_queue)
# 6. Re-route task using WorkflowRules
```

### Reassign Task

Supervisor reassigns a task to a different worker or queue.

```yaml
POST /processes/workflow/tasks/reassign
x-actors: [supervisor]
x-capability: workflow

requestBody:
  taskId: uuid               # Task to reassign
  targetWorkerId: uuid       # Assign to specific worker (optional)
  targetQueueId: uuid        # Move to queue (optional)
  reason: string             # Reassignment reason (required)
  priority: string           # Optionally change priority

responses:
  200:
    task: Task               # Updated task
    assignment: Assignment   # New assignment record

# Orchestrates:
# 1. Validate supervisor has authority over this task
# 2. Update Task.assignedToId or Task.queueId
# 3. Optionally update Task.priority
# 4. Create Assignment record
# 5. Create TaskAuditEvent (reassigned, priority_changed)
# 6. Update Caseload for affected workers
```

### Escalate Task

Escalate a task to supervisor for review.

```yaml
POST /processes/workflow/tasks/escalate
x-actors: [caseworker, supervisor]
x-capability: workflow

requestBody:
  taskId: uuid               # Task to escalate
  escalationType:
    - sla_risk               # At risk of missing SLA
    - complex_case           # Needs supervisor input
    - policy_question        # Policy clarification needed
    - client_complaint       # Client escalated issue
  notes: string              # Escalation details (required)

responses:
  200:
    task: Task               # Task with status: escalated
    escalatedTo: Supervisor  # Supervisor who received escalation

# Orchestrates:
# 1. Update Task.status → escalated
# 2. Identify appropriate supervisor (by team, escalation type)
# 3. Create Assignment to supervisor
# 4. Create TaskAuditEvent (escalated)
# 5. Optionally send notification to supervisor
```

### Bulk Reassign Tasks

Supervisor reassigns multiple tasks during surge or rebalancing.

```yaml
POST /processes/workflow/tasks/bulk-reassign
x-actors: [supervisor]
x-capability: workflow

requestBody:
  taskIds: uuid[]            # Tasks to reassign
  strategy:
    - to_worker              # Assign all to targetWorkerId
    - to_queue               # Move all to targetQueueId
    - distribute             # Distribute across targetWorkerIds
  targetWorkerId: uuid       # For to_worker strategy
  targetQueueId: uuid        # For to_queue strategy
  targetWorkerIds: uuid[]    # For distribute strategy
  reason: string             # Bulk reassignment reason

responses:
  200:
    updated: integer         # Count of successfully updated
    failed: TaskError[]      # Any failures with reasons
    assignments: Assignment[] # New assignment records

# Orchestrates:
# 1. Validate supervisor authority over all tasks
# 2. For distribute strategy, balance by current workload
# 3. Batch update Tasks
# 4. Batch create Assignments
# 5. Batch create TaskAuditEvents
# 6. Update Caseload for all affected workers
```

### Route Task

Apply workflow rules to determine task queue/assignment (typically system-initiated).

```yaml
POST /processes/workflow/tasks/route
x-actors: [system]
x-capability: workflow

requestBody:
  taskId: uuid               # Task to route
  skipRules: boolean         # Direct assignment without rules
  targetQueueId: uuid        # For skipRules: true
  targetWorkerId: uuid       # For skipRules: true

responses:
  200:
    task: Task               # Task with queue/assignment set
    rulesApplied: string[]   # Names of rules that matched
    assignment: Assignment   # If worker was assigned

# Orchestrates:
# 1. Load active WorkflowRules ordered by evaluationOrder
# 2. Evaluate priority rules → set Task.priority
# 3. Evaluate assignment rules → set Task.queueId
# 4. If strategy allows direct assignment, assign to worker
# 5. Create TaskAuditEvent (queue_changed, assigned)
```

### Start Verification

Initiate external data verification for a verification task.

```yaml
POST /processes/workflow/verification/start
x-actors: [caseworker, system]
x-capability: workflow

requestBody:
  taskId: uuid               # VerificationTask to start
  verificationSourceId: uuid # Which source to query
  manualOverride: boolean    # Skip automated check

responses:
  200:
    verificationTask: VerificationTask
  202:
    verificationTask: VerificationTask
    estimatedCompletion: datetime  # For async verification

# Orchestrates:
# 1. Validate VerificationSource is active
# 2. Update VerificationTask.status → awaiting_verification
# 3. If realtime_api source, call external API
# 4. If batch source, queue for batch processing
# 5. Create TaskAuditEvent (status_changed)
```

### Complete Verification

Record verification result and resolve any discrepancies.

```yaml
POST /processes/workflow/verification/complete
x-actors: [caseworker, system]
x-capability: workflow

requestBody:
  taskId: uuid               # VerificationTask to complete
  outcome:
    - verified
    - not_verified
    - discrepancy_found
    - waived
    - pending_documentation
  sourceResult:              # If from external source
    matchStatus: string
    sourceValue: string
    confidence: number
  resolution: string         # If discrepancy_found
  resolutionNotes: string
  documentIds: uuid[]        # Supporting documents

responses:
  200:
    verificationTask: VerificationTask
    discrepancyAlert: boolean  # True if needs review

# Orchestrates:
# 1. Update VerificationTask with outcome and resolution
# 2. If discrepancy requires review, escalate
# 3. Create TaskAuditEvent (completed)
# 4. Update EligibilityRequest if verification affects eligibility
# 5. If all verifications complete, trigger next workflow step
```
