# Case Management Domain

> **Status: Work in progress** — Case API implemented (alpha). Other entities (CaseWorker, Supervisor, Office, Team, Assignment, Caseload) are future work.

See [Domain Design Overview](../domain-design.md) for context and [Contract-Driven Architecture](../contract-driven-architecture.md) for the contract approach.

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

### Cases vs Tasks

A **Case** is the long-lived relationship with a client or household — it spans years, multiple applications, and multiple programs. A **Task** is a discrete unit of work with a deadline.

- A case worker can be **assigned to a case** (ongoing responsibility for a client) or **assigned to a task** (one-time work item)
- Tasks can be **case-level** (e.g., annual renewal, quality audit) or **application-level** (e.g., verify income for a specific application)
- Transferring a case typically transfers its active tasks as well

See [Workflow domain](workflow.md) for more detail on the Task entity.

## Contract Artifacts

Case Management is primarily **data-shaped** — most interactions are CRUD on cases, workers, teams, and offices. However, some operations are behavioral (case transfer, workload rebalancing, worker availability changes trigger reassignment). Expected contract artifacts:

| Artifact | Status | Notes |
|----------|--------|-------|
| OpenAPI spec | `case-management-openapi.yaml` | Case REST API (alpha). Workers, supervisors, offices, teams, assignments, caseloads TBD |
| State machine YAML | TBD | Case lifecycle (active, inactive, closed, transferred) with guards and effects (e.g., transfer triggers task reassignment) |
| Rules YAML | TBD | Assignment routing rules (e.g., match worker skills/programs to case, workload balancing strategies) |

Detailed schemas will be defined in the OpenAPI spec as the domain is developed.

## Key Relationships

```
Office (1) ──────< (many) CaseWorker
Office (1) ──────< (many) Team
Team (1) ────────< (many) CaseWorker
Supervisor (1) ──< (many) CaseWorker (via supervisorId)
CaseWorker (1) ──< (many) Task (via assignedToId)
CaseWorker (1) ──< (many) Case (via assignedWorkerId)
```

## Key Design Questions

- **Case lifecycle** — What states and transitions does a case go through? What triggers a case to move from active to inactive or closed?
- **Transfer behavior** — When a case transfers (new office or worker), what happens to active tasks? Automatic reassignment, or manual?
- **Workload balancing** — Is rebalancing a behavioral operation (RPC with rules) or an administrative action handled by the adapter?
- **Worker availability** — When a worker goes on leave, how are their tasks redistributed? Automatic via rules, or supervisor-initiated?
- **Domain boundary with Workflow** — Case Management tracks *who* is assigned; Workflow tracks *task state* and applies routing rules. Where exactly does assignment logic live?

## Related Documents

| Document | Description |
|----------|-------------|
| [Domain Design](../domain-design.md) | Case Management section in the domain overview |
| [Workflow](workflow.md) | Task lifecycle and routing — closely related domain |
| [Contract-Driven Architecture](../contract-driven-architecture.md) | Contract artifacts and the adapter pattern |
