# Workflow Domain

> **Status:** Task API implemented (alpha). Additional fields, entities, and behavioral artifacts are future work. The [workflow prototype](../../prototypes/workflow-prototype.md) proves a subset of these patterns (3 states, 3 transitions).

See [Domain Design Overview](../domain-design.md) for context and [Contract-Driven Architecture](../contract-driven-architecture.md) for the contract approach.

## Overview

The Workflow domain manages work items, tasks, SLA tracking, and task routing. It is a **behavior-shaped** domain — the task lifecycle involves state transitions, guards, effects, routing rules, and SLA enforcement.

## Current Implementation

### Task

A discrete unit of work with a lifecycle. [Spec: `workflow-openapi.yaml`](../../../packages/contracts/workflow-openapi.yaml)

| Field | Type | Industry Source |
|-------|------|-----------------|
| `id` | uuid, readOnly | Universal |
| `name` | string | [WS-HumanTask](https://docs.oasis-open.org/bpel4people/ws-humantask-1.1-spec-cs-01.html): `name`; [Camunda](https://docs.camunda.io/docs/apis-tools/tasklist-api-rest/controllers/tasklist-api-rest-task-controller/): `name`; ServiceNow: `short_description` |
| `description` | string | WS-HumanTask: task description; Camunda: `description`; ServiceNow: `description` |
| `status` | enum | WS-HumanTask: CREATED/CLAIMED/IN_PROGRESS/COMPLETED; Camunda: created/completed/canceled; ServiceNow: New/In Progress/Closed; [BPMN](https://www.bpmn.org/) task states |
| `startedAt` | date-time | ServiceNow: `opened_at`; WS-HumanTask: state transition timestamps |
| `completedAt` | date-time | ServiceNow: `closed_at`; Camunda: completion timestamp |
| `assignedToId` | uuid (ref User) | WS-HumanTask: `actualOwner` (single-owner pattern); Camunda: `assignee`; ServiceNow: `assigned_to` |
| `caseId` | uuid (ref Case) | Camunda: `caseInstanceId`; ServiceNow: parent reference |
| `createdAt` | date-time, readOnly | Universal; required by `api-patterns.yaml` |
| `updatedAt` | date-time, readOnly | Universal; required by `api-patterns.yaml` |

**Status values:** `pending`, `in_progress`, `completed`

**Key design decisions:**
- Explicit status over derived state — WS-HumanTask, Camunda, ServiceNow, and BPMN all model task state as an explicit field, not derived from timestamps. Status records *where the task is now*; timestamps record *when transitions happened*.
- Single-owner assignment — follows WS-HumanTask's `actualOwner` pattern. Group/queue assignment is future work.
- Minimal status enum — the base set maps to the universal core of every task system. States extend via overlay.

## Future Work

### Additional Task Fields

These fields appear in the full domain design and will be added in future issues:

| Field | Purpose | Industry Source |
|-------|---------|----------------|
| `priority` | expedited/high/normal/low | WS-HumanTask: `priority`; ServiceNow: `priority` |
| `queueId` | Reference to Queue | [WfMC](https://www.aiai.ed.ac.uk/project/wfmc/ARCHIVE/DOCS/refmodel/rmv1-16.html): Work Queue |
| `programType` | Benefits program (SNAP, Medicaid, TANF) | Benefits-domain-specific |
| `isExpedited` | Expedited processing flag | Benefits-domain-specific (7-day SNAP) |
| `requiredSkills` | Skills needed to work this task | WS-HumanTask: `potentialOwners` skill matching |
| `dueDate` | SLA deadline | WS-HumanTask: Deadline; Camunda: Timer Events |
| `slaTypeCode` | Reference to SLA configuration | ServiceNow: `contract_sla` |
| `slaInfo` | SLA tracking details (deadline, clock, status) | ServiceNow: [SLA Definition](https://www.emergys.com/blog/service-level-agreement-sla-for-servicenow/) |
| `sourceInfo` | What triggered this task | WfMC: process instance context |
| `parentTaskId` | For subtasks | WS-HumanTask: subtask model; BPMN: subprocess |
| `blockedByTaskIds` | Dependencies | BPMN: sequence flow dependencies |
| `outcomeInfo` | Completion details | WS-HumanTask: task output |

### Additional Entities

| Entity | Purpose | Industry Source |
|--------|---------|----------------|
| **TaskAuditEvent** | Immutable audit trail | [WfMC](https://www.aiai.ed.ac.uk/project/wfmc/ARCHIVE/DOCS/refmodel/rmv1-16.html): Task Event History; Camunda: [User Operation Log](https://docs.camunda.org/manual/latest/user-guide/process-engine/history/user-operation-log/); [Flowable](https://documentation.flowable.com/latest/reactmodel/bpmn/reference/audit): Audit Trail |
| **Queue** | Routes tasks to groups by team/program/skill | WfMC: Worklist; ServiceNow: Assignment Group; Camunda: Candidate Groups |
| **TaskType** | Task categorization config | ServiceNow: Category; Camunda: Task Definition Key; WS-HumanTask: Task Definition |
| **SLAType** | SLA deadline config by program and task type | ServiceNow: [SLA Definition](https://www.emergys.com/blog/service-level-agreement-sla-for-servicenow/); WS-HumanTask: Deadline/Escalation |
| **VerificationTask** | Verify data against external sources | Benefits-domain-specific — no equivalent in generic workflow standards |
| **VerificationSource** | External verification API registry (IRS, ADP, state databases) | Benefits-domain-specific integration pattern |

### State Machine

The task lifecycle defines 12 transitions. The [workflow prototype](../../prototypes/workflow-prototype.md) proves 3 transitions (claim, complete, release) with working examples. The remaining transitions use the same effect types and patterns.

Full states: `pending`, `in_progress`, `awaiting_client`, `awaiting_verification`, `awaiting_review`, `returned_to_queue`, `completed`, `cancelled`, `escalated`

Key behavioral patterns:
- Each transition trigger becomes an RPC API endpoint (e.g., `claim` -> `POST /workflow/tasks/:id/claim`)
- Guards enforce preconditions (e.g., task is unassigned, caller has required skills)
- Effects include: `set` (update fields), `create` (audit events), `lookup` (SLA config), `evaluate-rules` (routing), `event` (domain events)
- SLA clock pauses on `awaiting_client` and `awaiting_verification` states

### Rules

Assignment and priority rules are defined as decision tables using [JSON Logic](https://jsonlogic.com/). The prototype proves 2 assignment rules (SNAP-specific routing + catch-all) and 1 priority rule (expedited flag). See [workflow prototype](../../prototypes/workflow-prototype.md) for proven examples.

### Metrics

Four categories of operational metrics, with the prototype proving one metric from each source type:

| Category | Examples | Source Types |
|----------|----------|-------------|
| Task metrics | Time to claim, completion time, queue depth | Duration, state count |
| SLA metrics | Breach rate, at-risk count | Transition count, state count |
| Assignment metrics | Release rate, reassignment rate | Transition count |
| Verification metrics | Success rate, latency, match rate | Transition count, duration |

## Contract Artifacts

| Artifact | Status | Notes |
|----------|--------|-------|
| OpenAPI spec | Alpha | `workflow-openapi.yaml` — Task CRUD. Additional fields and entities in future issues |
| State machine YAML | Draft | 12 transitions; prototype proves 3. See [workflow prototype](../../prototypes/workflow-prototype.md) |
| Rules YAML | Draft | Assignment and priority rules; prototype proves 3 rules |
| Metrics YAML | Draft | 4 metric categories; prototype proves 3 metrics |

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
| [Scheduling](scheduling.md) | Appointments may trigger workflow tasks |
| [Contract-Driven Architecture](../contract-driven-architecture.md) | Contract artifacts and the adapter pattern |
