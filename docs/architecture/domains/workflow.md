# Workflow Domain

> **Status:** Task, Queue, and Events APIs implemented (alpha). State machine engine supports transitions, guards, `set`, `create`, `evaluate-rules`, and `event` effects with conditional execution via `when` clauses. Rule evaluation engine handles assignment and priority rules. SLA tracking is live — tasks carry `slaInfo` entries computed from `workflow-sla-types.yaml` on every transition. Metrics contract and `GET /metrics` endpoint are implemented. The [workflow prototype](../../prototypes/workflow-prototype.md) designs the full set of patterns.

See [Domain Design Overview](../domain-design.md) for context and [Contract-Driven Architecture](../contract-driven-architecture.md) for the contract approach.

## Overview

The Workflow domain manages work items, tasks, SLA tracking, and task routing. It is a **behavior-shaped** domain — the task lifecycle involves state transitions, guards, effects, routing rules, and SLA enforcement.

## Current Implementation

### Task

A discrete unit of work with a lifecycle. [Spec: `workflow-openapi.yaml`](../../../packages/contracts/workflow-openapi.yaml)

Based on: [WS-HumanTask](https://docs.oasis-open.org/bpel4people/ws-humantask-1.1-spec-cs-01.html), [Camunda Tasklist](https://docs.camunda.io/docs/apis-tools/tasklist-api-rest/controllers/tasklist-api-rest-task-controller/), ServiceNow Task, [BPMN](https://www.bpmn.org/) task states.

**Key design decisions:**
- Explicit status over derived state — all four systems model task state as an explicit field, not derived from timestamps.
- Single-owner assignment — follows WS-HumanTask's `actualOwner` pattern. Group/queue assignment is future work.
- Minimal status enum — the base set (`pending`, `in_progress`, `completed`) maps to the universal core of every task system. States extend via overlay.

### Domain Events

Immutable records emitted whenever a state machine transition fires or an object is created. The `event` effect type in the state machine YAML declares what action to record and what transition-specific data to include. All domains write to the same events collection — `domain`, `resource`, and `action` identify the event type. Read-only API (no POST/PATCH/DELETE). [Spec: `workflow-openapi.yaml`](../../../packages/contracts/workflow-openapi.yaml), [Schema: `components/events.yaml`](../../../packages/contracts/components/events.yaml)

| Concept | Industry Source |
|---------|----------------|
| Task event history | [WfMC](https://www.aiai.ed.ac.uk/project/wfmc/ARCHIVE/DOCS/refmodel/rmv1-16.html): Task Event History |
| Operation log | Camunda: [User Operation Log](https://docs.camunda.org/manual/latest/user-guide/process-engine/history/user-operation-log/) |
| Audit trail | [Flowable](https://documentation.flowable.com/latest/reactmodel/bpmn/reference/audit): Audit Trail |

### Queue

Work queues that tasks are routed into based on program type and other criteria. [Spec: `workflow-openapi.yaml`](../../../packages/contracts/workflow-openapi.yaml)

| Concept | Industry Source |
|---------|----------------|
| Work queue / worklist | [WfMC](https://www.aiai.ed.ac.uk/project/wfmc/ARCHIVE/DOCS/refmodel/rmv1-16.html): Worklist |
| Assignment group | ServiceNow: Assignment Group |
| Candidate group | Camunda: [Candidate Groups](https://docs.camunda.io/docs/apis-tools/tasklist-api-rest/controllers/tasklist-api-rest-task-controller/) |

### Rules

Assignment and priority rules evaluate automatically when tasks are created and when they re-enter a queue (e.g., after release). Rules are defined in [`workflow-rules.yaml`](../../../packages/contracts/workflow-rules.yaml) using [JSON Logic](https://jsonlogic.com/) conditions.

**Rule sets:**

| Rule Set | Trigger | Purpose |
|----------|---------|---------|
| `assignment` | `onCreate`, `release` | Route tasks to the correct queue based on program type |
| `priority` | `onCreate`, `release` | Set task priority based on expedited flag or other criteria |

**How rules connect to the state machine:**

Rules are invoked via `evaluate-rules` effects in the state machine YAML. The `onCreate` block evaluates both assignment and priority rules when a task is first created. The `release` transition re-evaluates them when a task returns to `pending`.

```yaml
# In workflow-state-machine.yaml
onCreate:
  effects:
    - type: evaluate-rules
      ruleType: assignment
    - type: evaluate-rules
      ruleType: priority
```

**Evaluation model:** Each rule set uses `first-match-wins` — rules are evaluated in `order` and the first matching rule's action is executed. The baseline rules in `workflow-rules.yaml` are a starting point; states replace them with their own logic. See [Customization](#customization) below.

### State Machine

The task lifecycle defines 12 transitions across 9 states. 4 transitions are implemented today (`create`, `claim`, `complete`, `release`) with guards and `set`/`create`/`evaluate-rules`/`event` effects working in the mock server. See [`workflow-state-machine.yaml`](../../../packages/contracts/workflow-state-machine.yaml). The remaining transitions use the same effect types and patterns.

**Implemented:** `pending`, `in_progress`, `completed` (3 states, 4 transitions including `onCreate`)

**Planned:** `awaiting_client`, `awaiting_verification`, `awaiting_review`, `returned_to_queue`, `cancelled`, `escalated` (6 additional states, 8 additional transitions)

Key behavioral patterns:
- Each transition trigger becomes an RPC API endpoint (e.g., `claim` -> `POST /workflow/tasks/:id/claim`)
- Guards enforce preconditions (e.g., task is unassigned, caller has required skills)
- Effects include: `set` (update fields), `create` (create related records), `evaluate-rules` (routing/priority), `event` (domain events)
- Conditional effects: `when` clause (JSON Logic) on any effect — fires only when the condition matches the request or resource context
- SLA clock pauses on `awaiting_client` and `awaiting_verification` states via `pauseWhen` JSON Logic in `workflow-sla-types.yaml`

## Customization

The baseline rules are a starting point — states replace them with their own program-specific routing and priority logic. See the [State Setup Guide](../../guides/state-setup-guide.md#customizing-behavioral-artifacts) for how to customize rules and other behavioral artifacts.

## Future Work

### Additional Task Fields

Future fields include subtasks and dependencies. These are designed in the [workflow prototype](../../prototypes/workflow-prototype.md) and based on [WS-HumanTask](https://docs.oasis-open.org/bpel4people/ws-humantask-1.1-spec-cs-01.html), [WfMC](https://www.aiai.ed.ac.uk/project/wfmc/ARCHIVE/DOCS/refmodel/rmv1-16.html), [Camunda](https://docs.camunda.io/docs/apis-tools/tasklist-api-rest/controllers/tasklist-api-rest-task-controller/), ServiceNow, and [BPMN](https://www.bpmn.org/) patterns.

### Additional Entities

| Entity | Purpose | Industry Source |
|--------|---------|----------------|
| **TaskType** | Task categorization config | ServiceNow: Category; Camunda: Task Definition Key; WS-HumanTask: Task Definition |
| **VerificationTask** | Verify data against external sources | Benefits-domain-specific — no equivalent in generic workflow standards |
| **VerificationSource** | External verification API registry (IRS, ADP, state databases) | Benefits-domain-specific integration pattern |

## Contract Artifacts

| Artifact | Status | Notes |
|----------|--------|-------|
| OpenAPI spec | Alpha | `workflow-openapi.yaml` — Task CRUD, Queue CRUD, Events (read-only), Metrics (read-only). Additional entities in future issues |
| State machine YAML | Alpha | `workflow-state-machine.yaml` — All 9 states and 12 transitions with guards, `set`/`create`/`evaluate-rules`/`event` effects, `when` conditional execution. See [workflow prototype](../../prototypes/workflow-prototype.md) |
| Rules YAML | Alpha | `workflow-rules.yaml` — Assignment and priority rule sets with JSON Logic conditions |
| SLA types YAML | Alpha | `workflow-sla-types.yaml` — 4 baseline SLA types (SNAP expedited/standard, Medicaid standard/disability) with `pauseWhen` conditions |
| Metrics YAML | Alpha | `workflow-metrics.yaml` — 5 baseline metrics: task time to claim, tasks in queue, release rate, SLA breach rate, SLA warning rate. See [Metrics](workflow-design-reference.md#metrics) |

## Key Design Questions

- **Verification workflow** — Should VerificationTask be a separate state machine or nested states within the main task lifecycle?
- **Cross-domain rule context** — How do rules reference `application.*` or `case.*` data? Requires context binding beyond `task.*`.
- **Batch operations** — How should bulk reassignment work? A `bulk-reassign` RPC trigger, or a batch REST endpoint?
- **Skill matching strategies** — How do `round_robin`, `least_loaded`, and `skill_match` assignment actions work as rule actions?
- **Notification effects** — What triggers notifications beyond escalation? SLA warnings? Assignment changes?

## Related Documents

| Document | Description |
|----------|-------------|
| [Workflow Design Reference](workflow-design-reference.md) | Feature-by-feature reference: vendor comparisons, design decisions, customization points |
| [Workflow Prototype](../../prototypes/workflow-prototype.md) | Full design — 9 states, 12 transitions, rules, metrics |
| [Domain Design](../domain-design.md) | Workflow section in the domain overview |
| [Case Management](case-management.md) | Staff, teams, offices — closely related domain |
| [Scheduling](scheduling.md) | Appointments may trigger workflow tasks |
| [Contract-Driven Architecture](../contract-driven-architecture.md) | Contract artifacts and the adapter pattern |
