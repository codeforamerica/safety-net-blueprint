# Case Management Domain

Detailed schemas for the Case Management domain. See [Domain Design Overview](../domain-design.md) for context.

## Overview

The Case Management domain manages ongoing client relationships, staff, and organizational structure.

| Entity | Purpose |
|--------|---------|
| **Case** | The ongoing relationship with a client/household |
| **CaseWorker** | Staff member who processes applications |
| **Supervisor** | Extends CaseWorker with approval authority |
| **Office** | Geographic or organizational unit (county, regional, state) |
| **Assignment** | Who is responsible for what |
| **Caseload** | Workload for a case worker |
| **Team** | Group of case workers |

---

## Capabilities

| Capability | Supported By |
|------------|--------------|
| **Supervisor** | |
| Assign task to any caseworker | `Assignment` entity, `CaseWorker.id` as target |
| Reassign between caseworkers/queues/counties | `Assignment`, `Office` for geographic routing |
| Monitor team workload | `Caseload` entity, `Team` for grouping |
| Run reports on productivity, backlog | `Caseload` (tasksOnTrack, tasksAtRisk, tasksBreached) |
| **Caseworker** | |
| Release or reassign a task | `Assignment.status: reassigned` |
| **System/Automation** | |
| Auto-assign by county | `Office.countyCode`, `CaseWorker.officeId` |
| Auto-assign by workload | `Caseload.activeTasks`, `CaseWorker.workloadCapacity` |
| Auto-assign by skills | `CaseWorkerSkill` matched against task requirements |

**Notes:**
- Task-specific capabilities (status updates, SLA tracking, queues, rules) are in the [Workflow domain](workflow.md).
- Case Management tracks *who* is assigned and assignment history. Workflow tracks *task state* changes.
- Auto-assign data (Office, Caseload, Skills) lives here; auto-assign rules (`WorkflowRule`) live in Workflow.

---

## Schemas

### Office

Geographic or organizational unit for routing and reporting.

```yaml
Office:
  properties:
    id: uuid
    name: string                    # "County A Office", "Regional Office - North"
    officeType:
      - county                      # County-level office
      - regional                    # Regional office overseeing multiple counties
      - state                       # State-level office
      - satellite                   # Satellite/outreach location
    parentOfficeId: uuid            # For hierarchies (e.g., county reports to regional)
    countyCode: string              # FIPS county code if applicable
    address: Address
    phoneNumber: PhoneNumber
    email: Email
    timezone: string                # For SLA calculations
    programs: enum[]                # Programs served: snap, medicaid, tanf
    status:
      - active
      - inactive
      - temporarily_closed
    createdAt, updatedAt: datetime
```

### CaseWorker

Staff member who processes applications and tasks.

```yaml
CaseWorker:
  properties:
    id: uuid
    name: Name
    employeeId: string
    email: Email
    phoneNumber: PhoneNumber
    officeId: uuid                  # Primary office assignment
    role:
      - intake_worker
      - eligibility_worker
      - quality_reviewer
      - appeals_specialist
    status:
      - active
      - inactive
      - on_leave
    supervisorId: uuid
    teamId: uuid
    skills: CaseWorkerSkill[]       # Skills, certifications, languages
    programs: enum[]                # Programs certified to work: snap, medicaid, tanf
    workloadCapacity: integer       # Max concurrent tasks
    currentWorkload: integer        # Current assigned tasks (computed)
    createdAt, updatedAt: datetime
```

### CaseWorkerSkill

Skills, certifications, and language abilities for a case worker.

```yaml
CaseWorkerSkill:
  properties:
    skillId: string                 # Unique identifier for the skill type
    name: string                    # "SNAP Eligibility", "Expedited Processing", "Spanish"
    skillType:
      - certification               # Formal credential (training, exam)
      - language                    # Language proficiency
      - specialization              # Area of expertise without formal cert
    # For certifications:
    certification:                  # Only present when skillType = certification
      issuedDate: date
      expirationDate: date
      issuingAuthority: string      # Who issued the certification
    # For languages:
    proficiencyLevel:               # Only present when skillType = language
      - basic
      - conversational
      - fluent
      - native
    status:
      - active
      - inactive
      - expired                     # For certifications past expiration
      - pending_renewal
```

### Supervisor

Extends CaseWorker with supervisory responsibilities.

```yaml
Supervisor:
  extends: CaseWorker
  properties:
    # Inherits all CaseWorker fields, plus:
    approvalAuthority:              # What this supervisor can approve
      - eligibility_determination
      - expedited_processing
      - denial
      - appeal_decision
      - exception_request
    teamCapacity: integer           # Max team members they can supervise
    currentTeamSize: integer        # Current direct reports (computed)
    canHandleEscalations: boolean
    escalationTypes:                # Types of escalations they handle
      - sla_breach
      - client_complaint
      - complex_case
      - inter_agency
```

### Case

The ongoing relationship with a client or household.

```yaml
Case:
  properties:
    id: uuid
    clientId: uuid                  # Primary client
    householdClientIds: uuid[]      # All clients in the household
    officeId: uuid                  # Assigned office
    assignedWorkerId: uuid          # Primary case worker
    status:
      - active
      - inactive
      - closed
      - transferred
    programs: enum[]                # Active programs: snap, medicaid, tanf
    openedDate: datetime
    closedDate: datetime
    closureReason: string
    createdAt, updatedAt: datetime
```

### Assignment

Tracks who is responsible for what work.

```yaml
Assignment:
  properties:
    id: uuid
    assignmentType:
      - case                        # Assigned to a case
      - application                 # Assigned to an application
      - task                        # Assigned to a task
    referenceId: uuid               # ID of case, application, or task
    assignedToId: uuid              # CaseWorker or Supervisor
    assignedById: uuid              # Who made the assignment
    assignedAt: datetime
    reason: string                  # Why this assignment was made
    status:
      - active
      - reassigned
      - completed
    createdAt, updatedAt: datetime
```

### Caseload

Workload tracking for a case worker.

```yaml
Caseload:
  properties:
    id: uuid
    caseWorkerId: uuid
    asOfDate: date                  # Snapshot date
    # Counts
    activeCases: integer
    activeTasks: integer
    pendingTasks: integer
    overdueTask: integer
    # By program
    casesByProgram:
      snap: integer
      medicaid: integer
      tanf: integer
    # SLA status
    tasksOnTrack: integer
    tasksAtRisk: integer
    tasksBreached: integer
    createdAt: datetime
```

### Team

Group of case workers.

```yaml
Team:
  properties:
    id: uuid
    name: string                    # "SNAP Intake Team A"
    description: string
    officeId: uuid                  # Office this team belongs to
    supervisorId: uuid              # Team supervisor
    programs: enum[]                # Programs this team handles
    status:
      - active
      - inactive
    createdAt, updatedAt: datetime
```

---

## Key Relationships

```
Office (1) ──────< (many) CaseWorker
Office (1) ──────< (many) Team
Team (1) ────────< (many) CaseWorker
Supervisor (1) ──< (many) CaseWorker (via supervisorId)
CaseWorker (1) ──< (many) Task (via assignedToId)
CaseWorker (1) ──< (many) Case (via assignedWorkerId)
```

---

## Process APIs

Process APIs orchestrate business operations by calling System APIs. They follow the pattern `POST /processes/{capability}/{action}` and use `x-actors` and `x-capability` metadata.

See [API Architecture](../api-architecture.md) for the full Process API pattern.

### Assignment Operations

| Endpoint | Actors | Description |
|----------|--------|-------------|
| `POST /processes/assignments/assign` | supervisor, system | Assign worker to case, application, or task |
| `POST /processes/cases/transfer` | supervisor | Transfer case to different office/worker |

### Workload Management

| Endpoint | Actors | Description |
|----------|--------|-------------|
| `POST /processes/teams/rebalance` | supervisor | Redistribute tasks across team members |
| `POST /processes/workers/update-availability` | caseworker, supervisor | Update worker status and availability |
| `GET /processes/workers/capacity` | supervisor, system | Get worker capacity for assignment decisions |

---

### Assign Worker

Assign a worker to a case, application, or task.

```yaml
POST /processes/assignments/assign
x-actors: [supervisor, system]
x-capability: case-management

requestBody:
  assignmentType:
    - case
    - application
    - task
  referenceId: uuid          # ID of case, application, or task
  assignedToId: uuid         # CaseWorker to assign
  reason: string             # Why this assignment

responses:
  200:
    assignment: Assignment   # New assignment record
    previousAssignment: Assignment  # If reassigning

# Orchestrates:
# 1. Validate worker has capacity (workloadCapacity vs currentWorkload)
# 2. Validate worker has required skills/programs
# 3. Close previous Assignment if exists
# 4. Create new Assignment record
# 5. Update Case/Task.assignedToId
# 6. Update Caseload for both workers (if reassignment)
# 7. Create TaskAuditEvent if task assignment
```

### Transfer Case

Transfer a case to a different office or worker.

```yaml
POST /processes/cases/transfer
x-actors: [supervisor]
x-capability: case-management

requestBody:
  caseId: uuid               # Case to transfer
  targetOfficeId: uuid       # New office (optional)
  targetWorkerId: uuid       # New worker (optional)
  transferReason:
    - client_moved           # Client relocated
    - workload_balance       # Rebalancing
    - skill_match            # Needs specialist
    - client_request         # Client requested
  notes: string              # Transfer details

responses:
  200:
    case: Case               # Updated case
    assignment: Assignment   # New assignment
    transferredTasks: Task[] # Tasks moved with case

# Orchestrates:
# 1. Validate supervisor authority over case
# 2. Update Case.officeId and/or Case.assignedWorkerId
# 3. Transfer all active tasks to new worker/queue
# 4. Create Assignment records
# 5. Update Caseload for both workers
# 6. If office changed, re-route tasks through WorkflowRules
```

### Rebalance Team Workload

Redistribute tasks across team members based on capacity.

```yaml
POST /processes/teams/rebalance
x-actors: [supervisor]
x-capability: case-management

requestBody:
  teamId: uuid               # Team to rebalance
  strategy:
    - by_capacity            # Distribute by available capacity
    - by_skill               # Match skills to tasks
    - even                   # Equal distribution
  includeTaskTypes: string[] # Only these task types (optional)
  excludeWorkerIds: uuid[]   # Workers to exclude (e.g., on leave)

responses:
  200:
    reassignments: ReassignmentSummary[]
    totalMoved: integer
    newDistribution: WorkerLoadSummary[]

# Orchestrates:
# 1. Get all team members and their current Caseload
# 2. Get all unassigned/redistributable tasks in team's queues
# 3. Calculate optimal distribution based on strategy
# 4. Batch reassign tasks
# 5. Update Caseload for all affected workers
# 6. Create TaskAuditEvents for all reassignments
```

### Update Worker Availability

Update a worker's status and availability, triggering reassignment if needed.

```yaml
POST /processes/workers/update-availability
x-actors: [caseworker, supervisor]
x-capability: case-management

requestBody:
  workerId: uuid             # Worker to update
  status:
    - active
    - on_leave
    - inactive
  effectiveDate: date        # When status takes effect
  expectedReturnDate: date   # For on_leave
  reassignTasks: boolean     # Reassign current tasks?
  reassignTo:
    - queue                  # Return to queue
    - team                   # Distribute to team
    - specific_worker        # Assign to targetWorkerId
  targetWorkerId: uuid       # For specific_worker

responses:
  200:
    worker: CaseWorker       # Updated worker
    reassignedTasks: integer # Count if reassigned

# Orchestrates:
# 1. Update CaseWorker.status
# 2. If reassignTasks and status != active:
#    a. Get all tasks assigned to worker
#    b. Reassign based on strategy
#    c. Update Caseload
#    d. Create TaskAuditEvents
# 3. If returning from leave, optionally reclaim tasks
```

### Get Worker Capacity

Get real-time capacity information for assignment decisions.

```yaml
GET /processes/workers/capacity
x-actors: [supervisor, system]
x-capability: case-management

parameters:
  workerId: uuid             # Specific worker (optional)
  teamId: uuid               # All workers on team (optional)
  officeId: uuid             # All workers in office (optional)
  programType: string        # Filter by program certification
  requiredSkills: string[]   # Filter by skills

responses:
  200:
    workers: WorkerCapacity[]
      - workerId: uuid
        name: string
        currentLoad: integer
        maxCapacity: integer
        availableCapacity: integer
        skills: string[]
        programs: string[]
        tasksAtRisk: integer   # Tasks approaching SLA

# Orchestrates:
# 1. Query CaseWorkers matching filters
# 2. Get current Caseload for each
# 3. Calculate available capacity
# 4. Return sorted by available capacity
```
