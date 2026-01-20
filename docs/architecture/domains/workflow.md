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

---

## Capabilities

| Capability | Supported By |
|------------|--------------|
| **Supervisor** | |
| Set or change task priority | `Task.priority`, `TaskAuditEvent.priority_changed` |
| Monitor task queues | `Queue` entity |
| Bulk reassign or reprioritize | Batch Operations API (`PATCH /tasks/batch`) |
| Monitor deadlines and alerts | `TaskSLAInfo.slaStatus`, `TaskAuditEvent.sla_warning/sla_breached` |
| Create tasks from external systems | `Task.sourceInfo` |
| **Caseworker** | |
| Update task status | `Task.status` (pending, in_progress, completed, etc.) |
| Release task I cannot complete | `Task.status: returned_to_queue` |
| **System/Automation** | |
| Auto-assign by rules | `WorkflowRule` with `ruleType: assignment` |
| Auto-prioritize based on rules | `WorkflowRule` with `ruleType: priority` |
| Create tasks on application submission | `Task.applicationId`, `Task.sourceInfo` |
| **Future** | |
| Forecast staffing needs | See [Future Considerations](../domain-design.md#future-considerations) |

**Notes:**
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
    taskType:
      # Document verification
      - verify_identity
      - verify_income
      - verify_employment
      - verify_residency
      - verify_citizenship
      - verify_resources
      - verify_expenses
      # Determination
      - eligibility_determination
      - benefit_calculation
      - expedited_screening
      # Communication
      - request_information
      - send_notice
      - schedule_interview
      - conduct_interview
      # Review
      - supervisor_review
      - quality_review
      # Inter-agency
      - inter_agency_referral
      - inter_agency_followup
      # Renewal
      - renewal_review
      - recertification
      # Appeals
      - appeal_review
      - hearing_preparation
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
    applicationId: uuid      # Reference to Application (Intake)
    assignedToId: uuid       # Reference to CaseWorker (Case Management)
    queueId: uuid            # Reference to Queue
    officeId: uuid           # Reference to Office (Case Management)
    programType: enum        # snap, tanf, medical_assistance
    requiredSkills: string[] # Skills needed to work this task
    dueDate: datetime        # SLA deadline
    slaInfo: TaskSLAInfo     # SLA tracking details
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
    programType: enum               # Optional: snap, medicaid, tanf
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

Defines automatic task routing and prioritization logic. Unifies assignment and priority rules with a shared condition structure.

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
    # Conditions - when this rule applies
    conditions:
      programTypes: enum[]          # Match these programs
      taskTypes: string[]           # Match these task types
      officeIds: uuid[]             # Match tasks from these offices
      # For priority rules, can also match on application/client attributes:
      hasChildrenUnderAge: integer  # Household has children under this age
      incomePercentFPL: number      # Income below this % of Federal Poverty Level
      isHomeless: boolean           # Client reports homelessness
      daysUntilDeadline: integer    # SLA deadline within N days
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

**Usage Examples:**

| Rule Type | Example | Conditions | Action |
|-----------|---------|------------|--------|
| Assignment | Route SNAP to County A queue | `programTypes: [snap]`, `officeIds: [county-a]` | `assignmentStrategy: specific_queue` |
| Priority | Expedite for young children | `hasChildrenUnderAge: 6` | `targetPriority: expedited` |
| Priority | High priority near deadline | `daysUntilDeadline: 5` | `targetPriority: high` |
| Assignment | Skill-based routing | `taskTypes: [appeal_review]` | `assignmentStrategy: skill_match` |

### TaskSLAInfo

SLA tracking details embedded in Task.

```yaml
TaskSLAInfo:
  properties:
    slaType:
      - snap_standard       # 30 days
      - snap_expedited      # 7 days
      - medicaid_standard   # 45 days
      - medicaid_disability # 90 days
      - tanf_standard       # 30 days
      - rfi_response        # Variable
      - appeal_standard     # Variable by state
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
    warningThresholdDays: integer
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

Process APIs orchestrate business operations by calling System APIs. They follow the pattern `POST /processes/{capability}/{action}` and use `x-actors` and `x-capability` metadata.

See [API Architecture](../api-architecture.md) for the full Process API pattern.

### Task Lifecycle

| Endpoint | Actors | Description |
|----------|--------|-------------|
| `POST /processes/tasks/claim` | caseworker | Claim an unassigned task from a queue |
| `POST /processes/tasks/complete` | caseworker | Complete a task with outcome |
| `POST /processes/tasks/release` | caseworker | Return a task to the queue |
| `POST /processes/tasks/reassign` | supervisor | Reassign a task to different worker/queue |
| `POST /processes/tasks/escalate` | caseworker, supervisor | Escalate a task to supervisor |
| `POST /processes/tasks/bulk-reassign` | supervisor | Reassign multiple tasks |

### Task Routing

| Endpoint | Actors | Description |
|----------|--------|-------------|
| `POST /processes/tasks/route` | system | Apply workflow rules to determine queue/assignment |

### Verification

| Endpoint | Actors | Description |
|----------|--------|-------------|
| `POST /processes/verification/start` | caseworker, system | Initiate external data verification |
| `POST /processes/verification/complete` | caseworker, system | Record verification result |

---

### Claim Task

Caseworker claims an unassigned task from a queue.

```yaml
POST /processes/tasks/claim
x-actors: [caseworker]
x-capability: task-management

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
POST /processes/tasks/complete
x-actors: [caseworker]
x-capability: task-management

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
POST /processes/tasks/release
x-actors: [caseworker]
x-capability: task-management

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
POST /processes/tasks/reassign
x-actors: [supervisor]
x-capability: task-management

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
POST /processes/tasks/escalate
x-actors: [caseworker, supervisor]
x-capability: task-management

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
POST /processes/tasks/bulk-reassign
x-actors: [supervisor]
x-capability: task-management

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
POST /processes/tasks/route
x-actors: [system]
x-capability: task-management

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
POST /processes/verification/start
x-actors: [caseworker, system]
x-capability: verification

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
POST /processes/verification/complete
x-actors: [caseworker, system]
x-capability: verification

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
