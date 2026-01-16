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
    certifications: CaseWorkerCertification[]
    programs: enum[]                # Programs certified to work: snap, medicaid, tanf
    workloadCapacity: integer       # Max concurrent tasks
    currentWorkload: integer        # Current assigned tasks (computed)
    languagesSpoken: Language[]
    createdAt, updatedAt: datetime
```

### CaseWorkerCertification

Skills and certifications for a case worker.

```yaml
CaseWorkerCertification:
  properties:
    certificationId: string         # Unique identifier for the certification type
    name: string                    # "SNAP Eligibility", "Expedited Processing", "Appeals"
    issuedDate: date
    expirationDate: date            # Optional
    status:
      - active
      - expired
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
