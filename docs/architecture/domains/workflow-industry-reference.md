# Workflow Domain: Industry Reference

A capability-by-capability comparison of the workflow contract architecture against major workflow and case management platforms. For each capability, this document describes how comparable systems handle the problem, the blueprint's specific approach and the trade-offs behind it, and where states are expected to customize via overlays.

See [Workflow Domain](workflow.md) for the architecture overview and [Contract-Driven Architecture](../contract-driven-architecture.md) for the adapter pattern.

## Features

**Workflow engine core**
- [State machine](#state-machine)
  - [States](#states)
  - [Transitions and effects](#transitions-and-effects)
  - [Timer-triggered transitions](#timer-triggered-transitions)
  - [Lifecycle hooks](#lifecycle-hooks-oncreate-onupdate)
- [Guards and access control](#guards-and-access-control)
- [Rules engine](#rules-engine)

**SLA and deadline tracking**
- [SLA and deadline management](#sla-and-deadline-management)
  - [SLA clock behavior by state](#sla-clock-behavior-by-state)
  - [SLA type definitions](#sla-type-definitions)

**Observability**
- [Domain events](#domain-events)
- [Metrics](#metrics)

---
- [Known gaps and future considerations](#known-gaps-and-future-considerations)
- [References](#references)

---

## State machine

### States

Every workflow system tracks which stage a work item is in — typically something like pending, active, blocked, or complete — because state drives routing, SLA accountability, and access control. Systems vary in granularity: JSM and ServiceNow use a small set of broad states with sub-statuses for nuance; WS-HumanTask defines a fixed set of abstract states; IBM Curam ties state to the underlying case process. The blueprint uses a flat, explicit state enum sized for benefits casework — with first-class states for waiting conditions that federal regulations treat differently for SLA purposes. Each state has distinct SLA clock behavior, routing implications, and access control requirements; they are modeled as first-class states rather than sub-statuses or flags.

**States:** `pending`, `in_progress`, `awaiting_client`, `awaiting_verification`, `escalated`, `pending_review`, `completed`, `cancelled`

The state set covers all task types in the domain. Task-type-specific states (e.g., fair hearing states like `hearing_scheduled`) are added alongside the baseline states and are only reachable via transitions guarded on `$object.taskType` — making them invisible to incompatible task types at runtime without requiring a separate state machine or separate API resource. See [Guards and access control](#guards-and-access-control) for how this works.

**Design decisions:**

- **Task state is an explicit field, not derived from timestamps or computed values.** Deriving state from timestamps is fragile — if `completedAt` is set but then cleared, what is the state? All major systems model task state explicitly. Explicit state is unambiguous and directly queryable.
- **`awaiting_client` and `awaiting_verification` are separate first-class states, not sub-reasons of a single `on_hold`.** Federal regulations treat client-caused and agency-caused delays differently for SLA accountability, resolution paths, and regulatory implications. ServiceNow collapses them into `on_hold` sub-reasons; first-class states enable distinct timer behavior and clearer federal reporting. Other vendors handle the same concepts:

  | Concept | Blueprint state | JSM | ServiceNow | Curam | Salesforce Gov Cloud | WS-HumanTask |
  |---|---|---|---|---|---|---|
  | Waiting for client action | `awaiting_client` | Waiting for Customer | On Hold / Awaiting Caller | Manual activity pending in inbox | Waiting on Someone Else | Suspended |
  | Waiting for third-party verification | `awaiting_verification` | Pending | On Hold / Awaiting Evidence | Suspended process | Deferred | Suspended |

  Pega handles waiting via an **Assignment Ready** field that delays SLA clock start rather than pausing a running clock — an alternative approach with different federal reporting implications (delayed start vs. excluded interval). Appian has no built-in waiting states; pause behavior must be modeled via intermediate process nodes or custom status fields.

- **Status values use snake_case.** Consistent with the blueprint's JSON API conventions and widely used in government API contexts (GitHub, Stack Exchange, Twitter). OpenAPI places no constraint on enum value casing; code generators map to language-appropriate forms (e.g., `InProgress` in TypeScript).
- **`cancelled` has a `reopen` transition that returns the task to `pending` with fresh routing.** Cancellation is sometimes an error, and supervisors need a way to reinstate a task without recreating it from scratch. Matches ServiceNow and Curam behavior.
- **`pending_review` is a dedicated state for structured supervisor sign-off before completion.** Quality control regulations in SNAP and Medicaid require supervisor approval before a determination is finalized. This is distinct from escalation — escalation is upward for help; review is a structured approval gate. A caseworker submits via `submit-for-review`; the supervisor either `approve`s (→ `completed`) or `return-to-worker`s (→ `in_progress`).
- **The SLA clock keeps running in `escalated` — urgency does not pause the agency's regulatory obligation.** Compare to `awaiting_client`, which pauses the clock because the delay is attributable to an external party.

**Customization points:**
- States can add their own status values via overlay (e.g., `awaiting_supervisor`).
- `slaClock` behavior per state can be overridden (e.g., a state may prefer to stop rather than pause the clock for `awaiting_client`, treating client delay as the client's time to spend).
- States needing tiered escalation (L1 → L2 → L3, as in JSM and ServiceNow) can add intermediate escalation states via overlay (e.g., `escalated_l2`, `escalated_supervisor`, `escalated_director`) with their own transitions and guards.

### Transitions and effects

> *Industry equivalents — transitions: "flow actions" (Pega), "state transitions" (ServiceNow), "sequence flows" (BPMN/Camunda). Effects: "post-functions" (JSM), "business rules" (ServiceNow), "activities" (Pega), "Smart Services" (Appian).*

Workflow systems vary in how they model state changes and the side effects that accompany them. Some expose a generic PATCH or update endpoint and infer intent from the diff; others use named transition operations with structured request bodies and explicit side effects. Named operations produce unambiguous audit events, can carry action-specific data (e.g., a cancellation reason), and can be independently guarded — at the cost of more API surface area. The blueprint uses named triggers that become RPC endpoints, with declarative effects specified in the state machine contract that the engine executes.

**Effect types in the blueprint:**
- `set` — update fields on the resource (e.g., set `assignedToId` when claiming a task)
- `evaluate-rules` — invoke the rules engine to re-evaluate assignment or priority
- `event` — emit a named domain event with an optional data payload
- `create` — write a new record to another collection (e.g., a follow-up task)
- `when` — conditional wrapper on any effect; uses JSON Logic to decide whether the effect fires

Transitions can be actor-triggered (a human or system makes an API call) or timer-triggered (fire automatically when a duration elapses — see [Timer-triggered transitions](#timer-triggered-transitions)).

**Design decisions:**

- **Transitions use named RPC endpoints, not PATCH requests.** `claim` → `POST /tasks/:id/claim`. Each trigger maps cleanly to an audit event, can carry a request body (e.g., a cancellation reason), and can be independently guarded. PATCH endpoints require parsing the diff to determine what changed and whether it was allowed. Comparable systems:

  | Concept | Blueprint | JSM | ServiceNow | Camunda | WS-HumanTask | Pega | Appian |
  |---|---|---|---|---|---|---|---|
  | Transition trigger | Named trigger → RPC endpoint | Status transition button | State flow trigger | Sequence flow / signal | Claim, start, complete, skip operations | Named flow action → RPC endpoint | Generic BPMN gateway with conditional flow |
  | Precondition | Guards (field/operator/value) | Validator condition | Condition script | Gateway condition | Constraints (potential owners, etc.) | Decision rule or router activity (scripted) | Conditional gateway expression (scripted) |
  | Side effect on transition | `set`, `create`, `evaluate-rules`, `event` effects | Post-function | Business Rule | Execution Listener | Task handler | Declare Expressions + activity steps | Smart Services (automation activities) |
  | Conditional effect | `when` (JSON Logic) | — | Condition on Business Rule | Expression on Listener | — | Condition on activity step | Conditional gateway branch |

- **Effects are declared in the state machine YAML, not implemented per-endpoint.** The state machine contract declares what should happen; the engine executes it. Implementations don't need to read source code to understand what a transition does — the contract is the specification.
- **`when` conditions use JSON Logic, not a separate condition language.** JSON Logic is already used for rules and metric filters. Using it for `when` conditions too means one evaluator, one set of tooling, and no learning curve for state implementers.
- **Transitions support `from: [array]` for shared triggers from multiple source states.** `cancel` fires from `pending`, `in_progress`, and `escalated`. Without array support, three blocks with the same guards and effects would be needed. `from: [pending, in_progress, escalated]` keeps it as one readable entry.
- **`return-to-worker` routes to `in_progress`, keeping the task with the assigned caseworker.** Returning to `pending` would force an unnecessary re-claim and break the revision cycle. When a supervisor returns work for revision, the same caseworker should revise it — not re-queue and re-claim it.
- **`de-escalate` routes to `pending`, not back to `in_progress`.** Tasks may be escalated from `in_progress` (assigned worker) or from `pending` (no assigned worker). Re-queuing via `→ pending` handles both: assigned-worker tasks can be immediately re-claimed; unassigned tasks re-queue cleanly without an `in_progress`-with-no-owner inconsistency. Consistent with `reopen → pending` and `release → pending`.
- **`reopen` clears assignment and re-evaluates routing via `pending`.** Cancellation implies closure — reopen should start fresh, not return the task to its original owner. The original caseworker may no longer be the right person for the case.
- **`cancel` is restricted to supervisors.** Closing a benefits application has federal reporting and client appeal implications — caseworkers cannot cancel unilaterally. States that want a worker-initiated request with supervisor approval can model this via a custom `request-cancel` state.
- **There is no `notify` effect type — notification is a consumer concern, handled by subscribers to domain events.** JSM, ServiceNow, and Curam all have built-in notification on escalation, which creates tight coupling to delivery mechanisms. States that need push notifications should build notification services that subscribe to domain events.

**Customization points:**
- States can add effects to existing transitions via overlay (e.g., send a notice to the client when `await-client` fires).
- States can add new transitions (e.g., a `pend` transition for applications requiring additional review before determination).

### Timer-triggered transitions

Most workflow systems support time-based automation — escalating tasks that sit too long, canceling requests after extended inactivity, or warning before a deadline is missed. Timer triggers typically fire relative to task creation, a deadline timestamp, or a timestamp marking when a waiting condition began. Whether the duration uses calendar days or business hours matters significantly for regulatory deadline calculations, since SNAP and Medicaid deadlines are calendar days while staffing SLAs are often business hours. The blueprint supports timer transitions on the state machine with explicit `after`, `relativeTo`, and `calendarType` fields.

**Design decisions:**

- **`calendarType` is explicit per transition — calendar days for regulatory deadlines, business hours for staffing SLAs.** Conflating the two produces incorrect enforcement and federal reporting errors. Regulatory deadlines (SNAP 30-day determination) are calendar days; staffing SLAs are typically business hours. Setting the wrong type silently miscalculates deadlines. Comparable systems:

  | Concept | JSM | ServiceNow | Curam |
  |---|---|---|---|
  | Time-based transition | SLA timer → auto-transition on breach | Escalation rule with time condition | Deadline escalation on process |
  | Business vs. calendar time | Configurable per SLA | Configurable per schedule | Configurable per deadline |
  | Relative to deadline | SLA breach point | SLA breach point | Process deadline |

- **Timer transitions support `relativeTo: slaDeadline` with a negative duration, firing before the breach point.** Reacting only after a deadline is missed is too late. A `-48h` offset gives supervisors time to intervene. This is how JSM and ServiceNow are typically configured to prevent breaches rather than just record them.
- **On SLA warning, the timer transition fires a state change to `escalated`, not just a notification.** JSM issues an SLA warning notification without changing task status. ServiceNow auto-escalates on breach. We follow the ServiceNow model: the state change + domain event creates a clear audit trail, triggers assignment and priority re-evaluation, and makes the escalation visible in queue views — all without requiring a separate notification integration. States that prefer notification-only can remove this timer via overlay.
- **`auto-escalate-sla-breach` fires at `0h` relative to `slaDeadline`, emitting a distinct `sla_breached` event at the deadline moment.** ServiceNow fires a distinct breach escalation separate from the warning. The blueprint follows the same model: the breach transition ensures a clear, queryable state change and a domain event carrying breach data for federal compliance reporting — distinct from the `-48h` warning transition.
- **All `after` durations in the baseline state machine are illustrative placeholders, expected to be overridden per state.** The correct timer thresholds vary by program type, jurisdiction, and policy — SNAP expedited (7-day deadline) needs a much shorter `auto-escalate` threshold than SNAP standard (30-day deadline), and neither baseline value should be used in production without review. Baseline values in the state machine:

  | Trigger | From | To | After | Relative to | Calendar type |
  |---|---|---|---|---|---|
  | `auto-escalate` | `pending` | `escalated` | 72h | `createdAt` | business |
  | `auto-escalate-sla-warning` | `in_progress` | `escalated` | -48h | `slaDeadline` | calendar |
  | `auto-escalate-sla-breach` | `pending`, `in_progress`, `escalated` | `escalated` | 0h | `slaDeadline` | calendar |
  | `auto-cancel-awaiting-client` | `awaiting_client` | `cancelled` | 30d | `blockedAt` | calendar |
  | `auto-resume-awaiting-verification` | `awaiting_verification` | `in_progress` | 7d | `blockedAt` | calendar |

**We support:** `on: timer`, `after` (duration string), `relativeTo` (task field or `slaDeadline`), `calendarType: calendar | business`

**Customization points:**
- All `after` durations are overlay points — states set their own thresholds per program type and regulatory requirement.
- States should configure separate timer thresholds for expedited vs. standard cases (different SLA deadlines).
- `calendarType` can be overridden per transition.
- Timer transitions support an optional `guards` field for conditional suppression — e.g., skip `auto-escalate` for tasks already flagged by a supervisor.

### Lifecycle hooks (`onCreate`, `onUpdate`)

> *Industry equivalents: "business rules (before/after insert/update)" (ServiceNow), "When rules" / "Declare Expressions" (Pega), "record-triggered flows" (Salesforce), "start/boundary events" (BPMN).*

Workflow systems need to run automation not just on explicit state transitions, but when objects are created or when specific fields change outside a transition. Creation hooks initialize derived state — routing a new task to a queue, setting its priority, emitting a creation event. Field-change hooks re-run routing logic when key attributes are updated after the fact (e.g., a supervisor marks a task as expedited after it was created as standard). The blueprint models these as `onCreate` and `onUpdate` lifecycle hooks in the state machine contract, keeping creation and update behavior co-located with transition behavior in the same declarative artifact.

**Design decisions:**

- **`onUpdate` includes an explicit `fields` filter — it fires only when listed fields change, not on every PATCH.** Without scoping, `onUpdate` would fire on every PATCH including updates made by transitions themselves, creating re-evaluation loops. The `fields` filter explicitly declares which field changes have downstream effects — e.g., `isExpedited` and `programType`, but not `assignedToId` (set by transitions). If a field isn't in the list, it's intentional. ServiceNow's Business Rules have the same scoping problem and solve it similarly with condition scripts. Comparable systems:

  | Concept | Blueprint | JSM | ServiceNow | Camunda | BPMN |
  |---|---|---|---|---|---|
  | On creation | `onCreate` | — | Business Rule on insert | Start event listener | Start event |
  | On field change | `onUpdate` (scoped by `fields`) | — | Business Rule on update | Execution listener on variable change | Data Object change event |

- **Transition-internal field changes (e.g., `set assignedToId`) do not trigger `onUpdate`.** `onUpdate` fires only on external PATCH requests. In benefits processing, this matters: a supervisor correcting a task's `programType` should re-trigger routing; a caseworker claiming a task should not.

**Customization points:**
- States can add `onUpdate` effects via overlay (e.g., send a supervisor alert when `priority` changes to `expedited`).
- States can extend the `fields` list to react to additional field changes.

---

## Guards and access control

> *Industry equivalents: "condition scripts" (ServiceNow), "validators" (JSM), "routing constraints" / "decision rules" (Pega), "gateway conditions" (Camunda/BPMN), "potential owner constraints" (WS-HumanTask).*

Workflow systems enforce preconditions on state transitions to prevent unauthorized or invalid operations — ensuring a task can't be claimed twice, that only supervisors can cancel, or that a caseworker can only act on their own assigned work. Most systems implement this via scripted conditions (ServiceNow, JSM) or expression languages (Camunda). The blueprint uses declarative field/operator/value guards defined at the top of the state machine and referenced by name from transitions, with `any`/`all` composition operators for OR/AND logic at the transition level. A transition only fires if all its guards pass.

**Design decisions:**

- **Compound conditions are expressed as `any`/`all` operators at the transition level, referencing named simple guards — not embedded logic inside guard definitions.** This keeps guard definitions readable (`field/operator/value`) and makes composition explicit and inspectable — consistent with how XState and similar declarative state machine systems handle compound preconditions. Comparable systems:

  | Concept | JSM | ServiceNow | Camunda | WS-HumanTask |
  |---|---|---|---|---|
  | Precondition | Validator (Groovy/JS) | Condition script (JS) | Expression language (JUEL/SpEL) | Deployment/routing constraints |
  | Role check | Project role condition | Role condition | Candidate group check | Potential owners list |
  | Compound condition | Multiple validators | Multiple conditions | Composite expression | — |

- **`callerIsSupervisor` is a named guard stub — RBAC will plug into this contract point when implemented.** `callerIsSupervisor` references `$caller.role`, which is the convention for what the platform-level RBAC service will expose. Until then, enforcement is at the service layer.
- **Automated verification callbacks use a dedicated `system-resume` trigger, not a relaxed version of the human `resume` guard.** IEVS and FDSH return results asynchronously. A separate trigger keeps domain events distinguishable and allows the request body to carry verification result data (source, result summary). SNAP and Medicaid quality control requirements also require this distinction in the audit trail — automated callbacks from IEVS, FDSH, and state data hubs are system actors, not human caseworkers.
- **Guards are defined at the top of the state machine and referenced by name across transitions — not duplicated inline.** Copying conditions to each transition creates inconsistency over time. Named guards stay consistent and make intent legible at a glance. Baseline guards:

  | Guard | Expression | Used on |
  |---|---|---|
  | `taskIsUnassigned` | `assignedToId is_null` | `claim` — prevents double-claiming in queue-based processing |
  | `callerIsAssignedWorker` | `assignedToId == $caller.id` | `complete`, `release`, `await-client`, etc. |
  | `callerIsSupervisor` | `$caller.role == supervisor` | `cancel`, `de-escalate`, `approve`, `return-to-worker` — enforces federal QC requirements on eligibility determinations |
  | `callerIsSystem` | `$caller.type == system` | `system-resume` |

  Compound conditions use composition at the transition level: `escalate` uses `any: [callerIsAssignedWorker, callerIsSupervisor]` — keeping named guards simple and composable.

- **`await-client` and `await-verification` require `callerIsAssignedWorker` — supervisors cannot block tasks unilaterally.** Blocking a task on external input reflects the caseworker's knowledge of the case. If a supervisor needs to block a task, they can reassign it to themselves. States that want supervisors to be able to await can add `callerIsSupervisor` to these guards via overlay.
- **There is no `entryGuards` concept per state — every transition must carry its own guards explicitly.** This is standard for declarative state machines but requires discipline when adding new transitions — a missing guard is a silent gap in access control. A future schema enhancement could enforce this at the contract level.
- **Guards on `$object.taskType` enable multiple lifecycles within a single state machine.** Task-type-specific transitions carry a named guard that checks `$object.taskType` (e.g., `taskTypeIsFairHearing: taskType equals fair_hearing`). This scopes those transitions to the applicable task type without requiring a separate state machine file, a separate API resource, or separate endpoints. The result is one API surface and shared infrastructure (queues, SLA tracking, domain events, assignment rules) serving multiple task lifecycles — consistent with how Pega (`caseTypeID`), Salesforce (`RecordTypeId`), and JSM (issue type) scope available operations within a single object type's API. Shared transitions like `cancel`, `assign`, and `set-priority` carry no task type guard and apply to all types. The trade-off: the OpenAPI status enum includes states from all task types, so `taskType` is the authoritative constraint on which states are reachable for a given task — not the schema.

**We support:** simple `field/operator/value` guards; composition operators (`any`, `all`) at the transition level for OR/AND conditions across named guards.

**Customization points:**
- States can add guards to existing transitions via overlay (e.g., restrict `claim` to workers assigned to the correct program team).
- States can define additional named guards for their custom transitions.
- Once platform-level RBAC is implemented, `callerIsSupervisor` can be tightened to reference the real role model without changing transition definitions.

---

## Rules engine

Routing logic — which queue a task goes to, what priority it gets — varies enormously across states and program types. The rules engine separates this logic from the state machine so each can change independently.

**Design decisions:**

- **`workflow-rules.yaml` is entirely replaceable per state, separate from the state machine.** Routing logic varies significantly across states — entangling it with the state machine would make customization harder. A state drops in their own rules file without touching the state machine. JSM and ServiceNow similarly decouple automation rules from workflow status transitions:

  | Concept | JSM | ServiceNow | Camunda | WfMC | Pega | Appian |
  |---|---|---|---|---|---|---|
  | Routing rules | Automation rules | Assignment rules | Task listener / routing | Participant resolution | Push (system assigns to operator/queue) + Pull (Get Next Work algorithm) | Automated Case Routing module (round-robin, workload balance, shared queue) |
  | Priority rules | Priority field automation | SLA-based priority | — | — | Urgency (1–100); SLA milestone-driven escalation | Process HQ KPI-based; no dedicated priority rule |
  | Rule order | First matching automation | Rule processing order | — | — | Router activity scripts; decision tree precedence | Rule number precedence (lower = higher priority) |

- **Pega supports both push routing (system assigns) and pull routing (Get Next Work algorithm).** Pull routing presents the next best assignment to a worker based on urgency, availability, and skills — the worker requests work rather than having it assigned. The blueprint uses push routing only; pull routing is a future consideration for caseworker queue management. Appian's Automated Case Routing module explicitly names its strategies (round-robin, workload balance, shared queue), which is the same model as the `routingStrategy` field planned for the Queue entity — confirming that named strategies are the industry-standard approach.
- **Rules use `first-match-wins` evaluation — simple, predictable, and easy to debug.** Rules are evaluated in order and the first match wins. Multi-factor weighted scoring — combining urgency, program type, task age, and other attributes into a numeric priority — is not expressible with `first-match-wins` and is a known gap.
- **Rules are invoked via `evaluate-rules` effects in the state machine — not embedded in rule definitions.** The state machine declares when rules run; the rules engine decides what happens. Neither system needs to understand the other's internals.
- **`escalate` uses `evaluate-rules: priority`, not `set priority: high`.** Hardcoding a priority value would break states with different escalation behavior per program. `evaluate-rules: priority` delegates the decision to the rules engine, which can apply different priority logic for expedited vs. standard cases. This is especially important in benefits processing, where SNAP expedited and standard cases have different deadline profiles.

**Customization points:**
- States replace `workflow-rules.yaml` entirely with their own assignment and priority rules.
- States can add `evaluate-rules` effects to additional transitions via overlay.

---

## SLA and deadline management

### SLA clock behavior by state

Workflow systems that track SLA deadlines need to handle delays attributable to external parties — when the agency is waiting on the client or a third-party verifier, that time should not count against the agency's processing deadline. All major systems support some form of clock pause, typically via hold states or sub-statuses that exclude certain intervals from SLA calculation. The blueprint declares clock behavior directly on each state via a `slaClock` field (`running`, `paused`, or `stopped`), consumed by the SLA engine when evaluating pause/resume conditions on every transition.

**Design decisions:**

- **`slaClock` is required on every state with no default.** If a state has no `slaClock` value, it's ambiguous whether the clock is running or stopped. Requiring explicit declaration forces intentional choices and prevents silent regressions when new states are added. The baseline assignment:

  | State | Clock behavior | Rationale |
  |---|---|---|
  | `pending` | running | Deadline starts at creation; time in queue counts against the agency |
  | `in_progress` | running | Work is actively in progress |
  | `escalated` | running | Still the agency's responsibility; urgency doesn't pause the deadline |
  | `awaiting_client` | paused | External dependency; federal regulations exclude client-caused delays from the agency's deadline |
  | `awaiting_verification` | paused | External dependency; clock resumes when verification service returns |
  | `pending_review` | running | Supervisor review counts against the agency's deadline |
  | `completed` | stopped | Work is done; deadline is no longer relevant |
  | `cancelled` | stopped | Work is abandoned; `reopen` transition restarts the clock from `pending` |

- **Waiting states use `slaClock: paused`, not `stopped`.** `paused` means the clock resumes from where it left off, preserving the original deadline. `stopped` would reset the clock, granting a fresh deadline on each block/resume cycle — federal SNAP regulations treat client-caused delays as excluded time, not as time that resets the agency's clock. Comparable systems:

  | Concept | Blueprint | JSM | ServiceNow | Curam | Pega | Appian |
  |---|---|---|---|---|---|---|
  | Pause SLA | `slaClock: paused` on states with external dependencies | "Pending" status excludes from SLA timers | On Hold sub-reasons pause SLA | SLA tracked at process level, not task state | Assignment Ready field delays clock start (clock doesn't begin until assignment is ready) | No built-in pause; requires custom process logic |
  | Stop SLA | `slaClock: stopped` on terminal states | Resolved / Closed | Resolved / Closed / Canceled | Process completed / aborted | Case resolution / Resolved stage | Process completion / case closure |
  | Business hours | `calendarType` per timer transition | Configurable per SLA | Configurable per schedule | Configurable per deadline | System-wide calendar configuration | Per-day-of-week configurable process calendar |

- **Pega uses a three-tier SLA model (Goal → Deadline → Passed Deadline) rather than a single deadline with a warning threshold.** Goal is a soft performance target; Deadline is the hard deadline; Passed Deadline is a repeating escalation interval after the deadline is missed. The blueprint uses a single deadline with a percentage-based warning threshold — simpler, but it lacks a separate performance-target tier. States that want Pega-style tiered escalation can model it with multiple timer transitions (warning → deadline → breach).
- **`pending_review` uses `slaClock: running` — supervisor review counts against the agency's deadline.** JSM and ServiceNow do not pause external SLA timers during approval states. States where regulation explicitly excludes review time from the deadline can override `slaClock` via overlay.

**Customization points:**
- States can override `slaClock` per state via overlay. A state that treats client non-response differently (e.g., stops rather than pauses) can do so without touching the baseline.
- The actual clock-pause/resume/stop logic is evaluated by the SLA engine on every transition using the `pauseWhen`/`resumeWhen` conditions in `*-sla-types.yaml` (see [SLA type definitions](#sla-type-definitions)). The `slaClock` value on each state declares the intent; the SLA engine reads the task's current state when evaluating those conditions.

### SLA type definitions

Federal regulations impose strict processing deadlines on benefits applications. The SLA types system tracks these deadlines per task, auto-assigns them based on task attributes, pauses the clock when delays are attributable to external parties, and warns before breach. SLA type definitions live in `*-sla-types.yaml`, separate from the state machine.

**Design decisions:**

- **SLA type definitions live in `*-sla-types.yaml`, a file that is independently replaceable per state.** A state with a different program mix needs to replace deadlines without touching lifecycle logic. JSM and ServiceNow store SLA definitions as separate database records, decoupled from workflow configuration. Embedding deadlines as constants in the state machine would couple two concerns that change independently.
- **Each task carries one `slaInfo` entry per applicable SLA type — multiple SLAs can apply simultaneously.** A SNAP application initially filed as standard may later be determined to qualify for expedited processing — both deadlines then apply. JSM and ServiceNow both support multiple SLA records per work item for exactly this reason. IBM Curam's single-deadline-per-process model is less flexible for multi-program cases. Comparable systems:

  | Concept | JSM | ServiceNow | IBM Curam | Salesforce Gov Cloud |
  |---|---|---|---|---|
  | SLA definition | SLA agreement (separate record) | SLA Definition (separate record) | Process deadline on case | Milestone on entitlement |
  | Multiple SLAs per record | Yes — multiple agreements can apply | Yes — multiple SLA records can attach | Typically one deadline per process | Multiple milestones per case |
  | Auto-attach conditions | Automation rule conditions | SLA Definition conditions (scripted/GUI) | Configured at process design time | Entitlement criteria |
  | Pause/resume | "Pending" sub-status excludes from timer | On-hold condition scripts | Not granular; handled at process level | Milestone pause conditions |
  | Warning before breach | Warning percentage on SLA agreement | Warning threshold on SLA Definition | Not built-in | Milestone warning time |

- **`autoAssignWhen` uses JSON Logic — the same evaluator used for guards, rules, and metric filters.** ServiceNow uses scripted conditions; JSM uses automation rules. `isExpedited == true` on the task causes `snap_expedited` to attach automatically at creation, with no second language to learn. The baseline SLA types — derived from federal regulatory deadlines — and their auto-assign conditions:

  | SLA type | Duration | Warning threshold | Pauses when |
  |---|---|---|---|
  | `snap_expedited` | 7 days | 75% elapsed | `awaiting_client` or `awaiting_verification` |
  | `snap_standard` | 30 days | 75% elapsed | `awaiting_client` or `awaiting_verification` |
  | `medicaid_standard` | 45 days | 75% elapsed | `awaiting_client` or `awaiting_verification` |
  | `medicaid_disability` | 90 days | 75% elapsed | `awaiting_client` or `awaiting_verification` |

- **`pauseWhen` / `resumeWhen` use JSON Logic conditions per SLA type — not a hardcoded list of states.** Different SLA types can have different pause behavior on the same state. A state might pause `snap_standard` but not `snap_expedited` during `awaiting_client` (the 7-day clock continues running). States can override pause behavior without modifying the state machine. ServiceNow's on-hold conditions work the same way.
- **The SLA clock is paused, not stopped, during `awaiting_client` — preserving the original deadline rather than granting a fresh one.** Federal SNAP regulations treat client-caused delays as excluded time. `pauseWhen` pauses rather than stops the clock, resuming from the same point. Stopping would grant a fresh deadline on each block/resume cycle, distorting federal reporting. JSM and ServiceNow default to the same behavior.
- **Warning thresholds are a percentage of the total SLA duration, not a fixed offset.** 75% of 7 days ≈ 5.25 days elapsed; 75% of 90 days = 67.5 days elapsed. A fixed 2-day offset would feel identical regardless of deadline length. ServiceNow uses the same percentage model on SLA Definitions.
- **`slaTypeCode` is an untyped string in the base contract — the valid enum is injected from `*-sla-types.yaml` at build time.** Hardcoding valid SLA type codes in the base OpenAPI spec would conflict with state overlays that add or replace types. The resolve pipeline injects the correct enum at build time.

**Customization points:**
- States can replace or extend SLA types via overlay.
- `pauseWhen` conditions can be tightened or loosened per regulatory interpretation — some states treat `awaiting_client` as the client's time to spend (stopping rather than pausing the clock) and can express that without touching the state machine.
- `autoAssignWhen` logic can be adjusted to match state-specific program routing criteria (e.g., attach `snap_expedited` when household income is below the expedited threshold, not just when `isExpedited` is set).

---

## Domain events

> *Industry equivalents: "audit log" / "issue history" (JSM), "audit log" / "event management" (ServiceNow), "case history" (Pega), "record events" (Appian). The blueprint's domain events go further — they are also the integration surface for cross-domain communication, not just an internal audit record.*

Domain events serve two purposes: they are the audit trail required by federal and state program regulations, and they are the integration surface for cross-domain communication (other domains subscribe to events rather than polling task state).

**Design decisions:**

- **Events are stored in a shared collection across all domains, identified by `domain`, `resource`, and `action`.** Siloed event stores per domain would require joining them for cross-domain queries. A shared collection enables queries like "show all events for this person across case management and workflow" without joining separate stores. JSM, ServiceNow, and Camunda each maintain separate audit logs per system — cross-system queries require custom reporting.
- **The audit trail must be immutable.** Events are never POST'd, PATCH'd, or DELETE'd via the API. Allowing mutations would undermine the regulatory function of the record. Federal quality control reviews and fair hearings depend on an unaltered history of who acted, when, and why. Comparable systems:

  | Concept | JSM | ServiceNow | Camunda | WfMC |
  |---|---|---|---|---|
  | Transition audit | Issue history | Audit log | User Operation Log | Task Event History |
  | Real-time stream | Webhooks | Event Management | Process event stream | — |
  | Immutable log | Read-only history | Read-only audit | History service | — |

- **The state machine YAML is the authoritative source for what events exist and what they carry.** `event` effects declare the action name and data payload. Implementations derive event schema from the contract — not from source code. In contrast, JSM and ServiceNow build audit records as a side effect of internal processing — the schema is implicit and not independently inspectable.

**Customization points:**
- States can add additional `event` effects to transitions via overlay (e.g., include the client's case number in the `completed` event payload for easier cross-referencing).
- Cross-domain event consumers subscribe to specific `action` values — adding new actions is non-breaking.

---

## Metrics

States and federal partners need operational visibility into queue health, processing time, and SLA compliance. All major systems bury metric definitions in proprietary GUI dashboards — non-portable and invisible to implementers. Metrics in the blueprint are contract artifacts defined in `workflow-metrics.yaml`, computed on demand from live task and event data.

**Design decisions:**

- **Metrics are defined as YAML contract artifacts alongside the state machine, not in a proprietary GUI.** All major systems (JSM, ServiceNow, Salesforce) define metrics through a proprietary GUI — non-portable and not version-controlled. Defining them as contract artifacts makes measurement definitions explicit, versionable, and portable across state implementations. This is a deliberate departure from industry norms.
- **Each metric is defined as a `collection` + `aggregate` + JSON Logic `filter` — not as hardcoded computation logic.** Adding a new metric is a data-definition problem, not a code problem. IBM Curam ties each metric to a fixed report type — adding a new metric often requires custom development. The decomposed model lets states define metrics declaratively. Baseline metrics:

  | Metric | Aggregate | Measures |
  |---|---|---|
  | `task_time_to_claim` | duration | Median time from task creation to first claim event |
  | `tasks_in_queue` | count | Tasks currently in `pending` status |
  | `release_rate` | ratio | Release events as a fraction of total task transitions |
  | `sla_breach_rate` | ratio | Tasks with at least one breached SLA entry |
  | `sla_warning_rate` | ratio | Auto-escalate-sla-warning events as a fraction of total transitions |

- **Metric filters use JSON Logic — the same evaluator used for guards and rules.** JSM uses JQL; ServiceNow uses condition scripts; Salesforce uses SOQL. A second filter language would mean two evaluators, two toolchains, and two learning curves. The trade-off is expressiveness: JSON Logic is less powerful than SQL. For the patterns needed here (filter by field value, check array membership), it is sufficient. Comparable systems:

  | Concept | JSM | ServiceNow | IBM Curam | Salesforce Gov Cloud | Pega | Appian |
  |---|---|---|---|---|---|---|
  | Metric definitions | Custom gadgets + SLA reports | Performance Analytics indicators | MIS caseload reports | Reports + formula fields | Application Quality + manager dashboards; role-configurable | Process HQ KPIs (count, duration, custom expression) |
  | Stored vs. computed | Pre-aggregated dashboards | Pre-aggregated by PA data collector | Pre-computed batch reports | Pre-aggregated by reports engine | Pre-aggregated dashboard views | Pre-computed from process execution data |
  | Filter conditions | JQL (Jira Query Language) | Conditions (scripted or condition builder) | Fixed filter criteria on report type | SOQL filter criteria | Case type, operator, date range (GUI) | Activity, sequence, custom field conditions (GUI) |
  | Event-pair duration | Pre-computed `resolutionDate - createdDate` field | Pre-computed duration field on task record | Pre-computed case duration field | Pre-computed formula field | Pre-computed start/end timestamps on case | Duration from process timeline |
  | Performance targets | SLA goals on SLA agreements | PA thresholds with color-coding | Fixed targets in MIS | Report filter thresholds | Goal/Deadline tiers on SLA definition | SLA fulfillment/violation thresholds |
  | Dimensional breakdown | Filter by project/team | Breakdown by group or category | Fixed groupings in report | Report group-by | Manager views by team/case type | Executive dashboard by process/activity |

- **Duration metrics are defined via `from`/`to` event pairs correlated by a `pairBy` field — not as pre-computed task fields.** Pre-computing duration as a task field requires deciding in advance which event pairs define "duration," locking in that decision at schema design time. The declarative model lets metric authors define new duration measurements without schema changes — any pair of events correlated by a shared field qualifies.
- **Performance `targets` are declared in the metric definition itself — not configured separately in a UI.** JSM puts goals on SLA agreements; ServiceNow puts thresholds on PA indicators — both in separate configuration surfaces. Declaring `targets` in the metric definition makes performance expectations visible to implementers at contract review time.
- **Dimensional breakdown is a query parameter (`groupBy`), not a property of the metric definition.** ServiceNow's PA breakdowns are baked into the indicator definition — modifying the definition to add a new view creates unnecessary coupling. `groupBy` as a query parameter allows any caller to slice any metric by any field without modifying the definition, consistent with how Grafana and Prometheus handle dimensions.
- **Pre-aggregation is an adapter-layer performance optimization, not a contract concern.** ServiceNow and JSM pre-aggregate metrics on a schedule for performance. For the blueprint's use case (development mock, contract definition), on-demand computation from live data is simpler, always current, and avoids a separate aggregation pipeline. States building production implementations will add pre-aggregation in their adapters — the metric definitions remain the same; only the computation strategy changes.

**Customization points:**
- States can replace or extend `workflow-metrics.yaml` via overlay.
- `targets` can be overridden to reflect state-specific performance goals.
- New metrics can be added for state-specific programs or reporting requirements.

---

## Known gaps and future considerations

Standard capabilities found in major workflow systems (JSM, ServiceNow, IBM Curam, Salesforce Government Cloud, Pega, Appian), and the blueprint's current coverage. See [References](#references) for system descriptions.

Status values: **Planned** = on the roadmap with a tracking issue; **Partial** = some coverage exists; **Not in scope** = intentional design boundary (handled by another domain); **Adapter layer** = intentionally delegated to the state adapter; not a blueprint contract concern; **Gap** = not yet assessed.

### Workflow engine

| Capability | Industry standard | Blueprint status |
|---|---|---|
| State machine versioning | All major platforms handle in-flight task migration when workflow definitions change — Pega via case type versioning, ServiceNow via flow version management | **Adapter layer** — migration strategy depends on the adapter's persistence model. |
| Multi-tier approval chains | Most platforms support L1 → L2 → director approval chains (Pega, ServiceNow, Appian) | **Partial** — one approval tier only. States can add intermediate states via overlay, but no baseline pattern exists. |
| Parallel task processing | Fork/join patterns allowing multiple tasks to run concurrently for the same case (ServiceNow, Pega, Appian, Curam) | **Not in scope** — parallel sub-tasks within a case are a case management domain concern. |
| Task dependencies | Blocking one task on completion of another (ServiceNow, JSM, Pega) | **Planned** — see issue #195. |
| Compensating transactions / rollback | If a transition's side effects fail partially, roll back to the prior state (Pega, Appian, ServiceNow) | **Adapter layer** — partial failure recovery is an implementation concern. |
| Retry logic for automated steps | Automatic retry with backoff when automated effects fail (all enterprise platforms) | **Adapter layer** — retry behavior is an infrastructure concern. |

### Routing and assignment

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Skill-based routing | Route to agents matching required skills (JSM, ServiceNow, Pega, Appian) | **Planned** — see issue #199. |
| Workload-based routing | Route to least-loaded or most-available agent (ServiceNow, Appian Workload Balance, Pega Get Next Work) | **Planned** — see issue #198. |
| Named routing strategies | Explicit strategies: round-robin, least-loaded, shared queue (Appian Automated Case Routing, ServiceNow) | **Planned** — see issue #198. |
| Pull routing / Get Next Work | Worker requests their next best assignment; system selects based on urgency, skills, and availability (Pega Get Next Work) | **Planned** — see issue #196. |
| Delegation / out-of-office routing | When a caseworker is unavailable, tasks automatically redirect to a substitute or back to the queue (JSM, ServiceNow, Pega, Appian, Salesforce) | **Planned** — see issue #188. |
| Overflow routing | When a queue exceeds capacity, tasks overflow to a backup queue (JSM, ServiceNow, Pega) | **Adapter layer** — high-volume routing logic is an adapter concern. |
| Bulk reassignment | Supervisor reassigns multiple tasks at once (JSM, ServiceNow, Curam) | **Planned** — see issue #183. |
| Weighted priority scoring | Multi-factor priority scoring combining urgency, program type, age, and other attributes into a numeric score (Pega Urgency 1–100, ServiceNow urgency × impact) | **Planned** — see issue #200. |
| Delegation / identity acting-as | One user acting on behalf of another with a dual-identity audit trail distinguishing who acted from who they acted as (JSM, ServiceNow, Pega) | **Not in scope** — a cross-cutting platform concern resolved before the state machine sees the request. See issue #181. |

### SLA and deadline management

| Capability | Industry standard | Blueprint status |
|---|---|---|
| SLA goal tier | Soft performance target separate from the hard deadline — Goal / Deadline / Passed Deadline (Pega three-tier) | **Planned** — see issue #189. |
| Holiday calendar management | Agency-specific holiday calendars that exclude non-working days from SLA calculations (JSM, ServiceNow, Pega, Appian, Salesforce) | **Planned** — federal holiday exclusion is required for correct regulatory deadline calculation. See issue #190. |
| SLA retroactive recalculation | When task attributes change after creation (e.g., `isExpedited` is set), SLA deadlines are recalculated accordingly (ServiceNow, Pega, Curam) | **Planned** — see issue #191. |
| Deadline extensions | Formal process for extending a deadline with documented justification (ServiceNow, Curam, Pega) | **Planned** — see issue #192. |
| Grace period handling | A defined window after the deadline before adverse action is taken — common in SNAP and Medicaid processing | **Planned** — see issue #197. |

### Task structure and types

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Task-to-record linkage | Tasks associated with the case, application, or entity they are about (JSM, ServiceNow, Curam, Pega) | **Planned** — see issue #177. |
| Task type differentiation by program | Different programs (SNAP, Medicaid, TANF) have different task schemas, required fields, and workflows (Curam, Pega, Appian, ServiceNow) | **Planned** — see issue #193. |
| Task notes / comments | User-authored notes on a task (Pega, Appian, ServiceNow, JSM) | **Not in scope** — notes belong on the case, not the task. Owned by the [Case Management](case-management.md) domain. |
| Task checklists / sub-items | Required steps or document checklists within a task (ServiceNow, Appian, JSM) | **Not in scope** for the baseline. |
| Task templates | Pre-defined task configurations for recurring work types (ServiceNow, JSM, Pega, Appian) | **Not in scope** for the baseline. |

### Access control

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Role enforcement | Roles enforced by platform middleware on every operation | **Not in scope** — authentication and caller context injection is a cross-cutting platform concern. Guard stubs are the contract integration points. |
| Field-level access control | Caseworkers can view but not edit certain fields; supervisors see additional fields; sensitive data masked by role (all major platforms) | **Not in scope** — a cross-cutting RBAC platform concern, not per-domain. |
| Confidential / sensitive case handling | Domestic violence address confidentiality, restricted-access cases, need-to-know enforcement (Curam, ServiceNow, Salesforce) | **Not in scope** — confidentiality is a property of the case. Owned by the [Case Management](case-management.md) domain. |
| Read access logging | Logging who viewed sensitive task data (PII/PHI) — required for HIPAA and federal QC (Curam, ServiceNow, Salesforce) | **Not in scope** — a cross-cutting platform infrastructure concern. |

### Integration and events

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Event-triggered task creation | Tasks auto-created when domain events fire (e.g., `application.submitted` → review task) | **Planned** — event infrastructure is in place; the wiring that maps incoming events to task creation is not yet implemented. See issue #163. |
| Real-time event streaming / webhooks | Push notifications to external subscribers when events fire (JSM webhooks, ServiceNow Event Management, Pega, Appian) | **Not in scope** — a cross-cutting platform concern; real-time delivery should not be duplicated per domain. |
| Event replay | Ability to replay past events for debugging or migrating to a new system (ServiceNow, Pega, Appian) | **Not in scope** — a cross-cutting platform operations concern. |
| Notification on state change | Configurable push notifications on escalation, block, completion, etc. | **Not in scope** — handled by the [communications domain](../cross-cutting/communication.md), which subscribes to domain events. |

### Reporting and analytics

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Operational reporting | Built-in reports on caseload, productivity, backlog, and team performance (JSM, ServiceNow, Pega, Appian, Curam) | **Not in scope** — a reporting-domain concern. Workflow metrics provide the raw data; report generation is out of scope. |
| Staffing forecasting | Predictive models for upcoming workload and staffing needs based on historical trends and upcoming deadlines (Pega, ServiceNow, Curam) | **Not in scope** — a reporting-domain concern. |

### Compliance and government-specific

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Federal reporting exports | Structured exports for SNAP (FNS-388), Medicaid (T-MSIS), and other federal reporting requirements (Curam, Pega, ServiceNow) | **Not in scope** — a reporting-domain concern. |
| Fair hearing / appeals tracking | Dedicated workflow for applicant appeals with hearing date scheduling, statutory deadlines (90-day rule), and outcome tracking (Curam, Pega, ServiceNow) | **Planned** — depends on issue #193 (task type as lifecycle discriminator). |
| Change of circumstance handling | When household composition, income, or program status changes mid-case, associated tasks are automatically created or updated (Curam, Pega) | **Not in scope** — handled via cross-domain event wiring (see issue #163). |
| Overpayment / recoupment tracking | Tracking and recovering benefits paid in error, including repayment schedules and federal reporting (Curam, Pega) | **Not in scope** — a case management or financial domain concern. |

---

## References

### Systems and platforms compared

| System | Description |
|---|---|
| [Atlassian Jira Service Management (JSM)](https://www.atlassian.com/software/jira/service-management) | IT service management platform with configurable workflows, automation rules, and SLA tracking. Widely used in government IT operations. |
| [ServiceNow](https://www.servicenow.com/) | Enterprise workflow and service management platform. Leading government adopter; strong SLA, timer, escalation, and notification features. |
| [IBM Curam](https://www.ibm.com/products/curam-social-program-management) | Social program management platform purpose-built for benefits administration (SNAP, Medicaid, TANF). Used by several U.S. states and international governments. |
| [Salesforce Government Cloud](https://www.salesforce.com/solutions/government/) | CRM and case management platform for public sector. FedRAMP authorized; used by several states for benefits case management and constituent services. |
| [Pegasystems (Pega)](https://www.pega.com/) | BPM and case management platform. Named a Leader in the Gartner Magic Quadrant for BPM-Platform-Based Case Management Frameworks; significant government and healthcare presence. Key docs: [Case Life Cycle Design](https://academy.pega.com/topic/case-life-cycle-design/v2), [SLAs](https://academy.pega.com/topic/service-level-agreements/v6), [Assignment Routing](https://academy.pega.com/topic/assignment-routing/v1), [Get Next Work](https://academy.pega.com/topic/get-next-work-feature/v1). |
| [Appian](https://appian.com/) | Low-code BPM and case management platform. Named a Leader in Gartner's LCAP and BPM Magic Quadrants; FedRAMP authorized with documented government credentials. Key docs: [Case Management Studio](https://docs.appian.com/suite/help/26.2/case-management-studio-overview.html), [Automated Case Routing](https://docs.appian.com/suite/help/24.4/cms-automated-case-routing-overview.html), [KPIs](https://docs.appian.com/suite/help/25.4/process-custom-kpis.html), [Record Events](https://docs.appian.com/suite/help/25.4/record-events.html). |
| [Camunda](https://camunda.com/) | Open-source BPMN-native workflow and process orchestration engine. Useful reference for BPMN-aligned state machine and human task patterns. |
| [WfMC / WS-HumanTask](https://www.oasis-open.org/committees/tc_home.php?wg_abbrev=bpel4people) | OASIS standard for human task management in service-oriented architectures. Predecessor to modern task API patterns; referenced for WS-HumanTask state model. |

### Standards and specifications

| Standard | Description |
|---|---|
| [BPMN 2.0](https://www.omg.org/spec/BPMN/2.0/) | Business Process Model and Notation — OMG industry standard for process modeling. |
| [JSON Logic](https://jsonlogic.com/) | Portable rule/expression format used in the blueprint for guards, rule conditions, and metric filters. |
| [OpenAPI 3.x](https://spec.openapis.org/oas/v3.1.0) | API specification standard used for all blueprint contract artifacts. |

### Federal regulatory references

| Regulation | Description |
|---|---|
| [7 CFR Part 273](https://www.ecfr.gov/current/title-7/subtitle-B/chapter-II/subchapter-C/part-273) | SNAP program regulations — processing timelines, quality control requirements, and the basis for blueprint SLA deadlines (7-day expedited, 30-day standard). |
| [42 CFR Part 435](https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-C/part-435) | Medicaid eligibility regulations — 45-day processing requirement for most Medicaid; 90-day for disability-related determinations. |

### Industry research

| Source | Description |
|---|---|
| [Gartner Magic Quadrant for BPM-Platform-Based Case Management Frameworks](https://www.gartner.com/en/documents/3488121) | Vendor landscape for case management platforms. Leaders include Pega, Appian, IBM, and Microsoft. |
| [Gartner Top Trends in Government: Case Management as a Service (2022)](https://www.gartner.com/en/doc/785084-top-trend-in-government-case-management-as-a-service) | Government-specific case management trends; introduces the CMaaS composable architecture model. |
| [Gartner Magic Quadrant for Business Orchestration and Automation Technologies](https://www.flowable.com/gartner-market-guide) | Successor to the BPM MQ; covers workflow orchestration vendors including Appian, Pega, ServiceNow, and Flowable. |
