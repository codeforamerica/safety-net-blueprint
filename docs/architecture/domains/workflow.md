# Workflow Domain

The Workflow domain manages the lifecycle of work items (tasks), their routing to queues, SLA tracking against regulatory deadlines, and operational metrics. It is a **behavior-shaped** domain — the task lifecycle is governed by a state machine with guards, effects, and routing rules rather than ad-hoc CRUD logic.

See [Domain Design Overview](../domain-design.md) for context and [Contract-Driven Architecture](../contract-driven-architecture.md) for the contract approach.

## Domain Model

### Task

A task is the atomic unit of caseworker activity — reviewing an application, verifying a document, completing a redetermination. It represents a single, ownable piece of work with a clear beginning and end. Tasks are assigned to a single owner (caseworker, supervisor, or automated process) at a time and have an explicit lifecycle governed by the [state machine](#state-machine). They carry `slaInfo` entries that track deadline status against regulatory requirements, and link to a `Queue` that controls routing and visibility. [Spec: `workflow-openapi.yaml`](../../../packages/contracts/workflow-openapi.yaml)

### Queue

Queues are the organizing structure for caseworker workloads. A queue represents a logical grouping of tasks — typically by program (SNAP, Medicaid), team, or skill — and determines which workers can see and claim which tasks. Tasks enter a queue automatically when created or released, based on assignment rules. Supervisors manage queues to balance workload across their teams. [Spec: `workflow-openapi.yaml`](../../../packages/contracts/workflow-openapi.yaml)

### Domain Events

Every state machine transition and lifecycle hook emits an immutable domain event. Events serve two purposes: they are the audit trail (a complete history of what happened to every task and when) and the integration surface for cross-domain communication (other domains subscribe to workflow events rather than polling task state). All domains share the same events collection; `domain`, `resource`, and `action` identify the event type. Read-only API. [Spec: `workflow-openapi.yaml`](../../../packages/contracts/workflow-openapi.yaml)

### State Machine

The task lifecycle is governed by a declarative state machine rather than ad-hoc endpoint logic. Tasks move through states like `pending` → `in_progress` → `awaiting_client` → `in_progress` → `completed`, with each transition triggered by an explicit named action. Transitions declare guards (preconditions) and effects (side effects such as updating fields or emitting events). The state machine also supports multiple lifecycles within the same domain — task-type-specific states and transitions are scoped via `taskType` guards, keeping fair hearing tasks, recertification tasks, and standard casework tasks within a single contract. [Spec: `workflow-state-machine.yaml`](../../../packages/contracts/workflow-state-machine.yaml)

See [State machine](workflow-design-rationale.md#state-machine) in the design reference for the full transition table, guard definitions, and design decisions.

### Rules

Assignment and priority rules express routing logic that doesn't belong in the state machine. When a task is created or returns to `pending`, rules determine which queue it should go to and what priority it should have. Keeping this logic in a separate rules file means states can replace their routing and priority logic entirely without touching the state machine.

| Rule Set | Purpose |
|----------|---------|
| `assignment` | Route tasks to the correct queue based on program type and other criteria |
| `priority` | Set task priority based on expedited status, program type, or other criteria |

Rules use a `first-match-wins` evaluation model. The baseline rules are illustrative — states replace them with their own program-specific routing logic. See [Rules engine](workflow-design-rationale.md#rules-engine) in the design reference.

### SLA Types

Federal regulations impose strict processing deadlines on benefits applications. SLA types define these deadlines and the conditions under which the clock pauses (e.g., while waiting on the client) and resumes. Each task carries a `slaInfo` array with one entry per applicable SLA type, tracking deadline status in real time. SLA types are auto-assigned at task creation based on task attributes and updated on every state transition. [Spec: `workflow-sla-types.yaml`](../../../packages/contracts/workflow-sla-types.yaml)

See [SLA and deadline management](workflow-design-rationale.md#sla-and-deadline-management) in the design reference for baseline types, clock behavior, and design decisions.

### Metrics

Operational metrics give supervisors visibility into queue health, team performance, and compliance risk. Each metric is defined declaratively in a contract artifact — specifying what data to query, how to aggregate it, and optionally what performance target to evaluate against. [Spec: `workflow-metrics.yaml`](../../../packages/contracts/workflow-metrics.yaml)

See [Metrics](workflow-design-rationale.md#metrics) in the design reference for baseline metrics and design decisions.

## Customization

The baseline contracts are a starting point. States customize via overlays:

- **State machine**: add transitions, extend guards, add effects to existing transitions
- **Multiple lifecycles**: add task-type-specific states and transitions scoped via `taskType` guards to support multiple lifecycles within the same domain (e.g., fair hearing tasks alongside standard casework tasks) — see issue #193
- **Rules**: replace `workflow-rules.yaml` entirely with state-specific assignment and priority logic
- **SLA types**: replace or extend `workflow-sla-types.yaml` with state-specific deadlines and pause conditions (overlay support: issue #174)
- **Metrics**: replace or extend `workflow-metrics.yaml` with state-specific metrics and targets (overlay support: issue #174)

See the [State Overlays Guide](../../guides/state-overlays.md) for overlay mechanics.

## Future Work

| Capability | Notes |
|------------|-------|
| Polymorphic subject association | Tasks should link to applications, cases, and other entities via `subjectId`/`subjectType` rather than entity-specific FK fields. See issue #177. |
| Cross-domain event wiring | Application submitted → review task auto-created. Events infrastructure is in place; wiring that maps domain events to task creation is not yet implemented. |
| Role-based access control | Guards reference `$caller.role` and `$caller.type`; enforcement is at the service layer until RBAC is implemented. |
| Overlay support for behavioral YAMLs | States can't yet overlay `*-sla-types.yaml`, `*-metrics.yaml`, or `*-state-machine.yaml`. See issue #174. |
| Named routing strategies + skill-based assignment | Queue routing strategy field and built-in routing actions. See issue #162. |
| Pull routing | Caseworkers request their next best task rather than selecting from a queue. See issue #196. |
| Task dependencies | Blocking one task on completion of another, with automatic unblocking. See issue #195. |
| Task type as lifecycle discriminator | `taskType` as a first-class state machine concept enabling multiple lifecycles. See issue #193. |
| Delegation / out-of-office routing | Automatic task redirection when a caseworker is unavailable. See issue #188. |
| SLA goal tier | Soft performance target alongside the hard regulatory deadline. See issue #189. |
| Holiday calendar support | Agency-specific holiday exclusions for business-day SLA calculations. See issue #190. |
| SLA deadline recalculation | Recalculate deadlines when task attributes change after creation. See issue #191. |
| Deadline extensions | Formal process for extending a deadline with documented justification. See issue #192. |
| Grace period timer | Explicit overlay point for post-deadline grace periods before adverse action. See issue #197. |

For a comprehensive gap assessment including items out of scope and platform-level concerns, see [Known Gaps and Future Considerations](workflow-design-rationale.md#known-gaps-and-future-considerations) in the design reference.

## Contract Artifacts

| Artifact | File |
|----------|------|
| OpenAPI spec | `workflow-openapi.yaml` — Tasks, Queues, Events, Metrics |
| State machine | `workflow-state-machine.yaml` — States, transitions, guards, effects |
| Rules | `workflow-rules.yaml` — Assignment and priority rule sets |
| SLA types | `workflow-sla-types.yaml` — Baseline SLA types for SNAP and Medicaid |
| Metrics | `workflow-metrics.yaml` — Baseline operational metrics |

## Related Documents

| Document | Description |
|----------|-------------|
| [Workflow Design Reference](workflow-design-rationale.md) | Industry reference: vendor comparisons, design decisions, customization points, and comprehensive gap assessment |
| [Workflow Prototype](../../prototypes/workflow-prototype.md) | Full design spec — states, transitions, rules, metrics |
| [Domain Design](../domain-design.md) | Workflow section in the domain overview |
| [Case Management](case-management.md) | Staff, teams, offices — closely related domain |
| [Scheduling](scheduling.md) | Appointments may trigger workflow tasks |
| [Contract-Driven Architecture](../contract-driven-architecture.md) | Contract artifacts and the adapter pattern |
