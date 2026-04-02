# Workflow Domain: Feature Design Rationale

A feature-by-feature reference for the workflow contract architecture. For each capability, this document describes what the blueprint provides, how comparable systems handle the same problem, the trade-offs behind our design choices, and where states are expected to customize via overlays.

See [Workflow Domain](workflow.md) for the architecture overview and [Contract-Driven Architecture](../contract-driven-architecture.md) for the adapter pattern.

---

## Task lifecycle states

The task status enum defines the complete set of states a task can occupy. States are explicit fields on the Task resource — not derived from timestamps or other computed values. The state set was designed around the actual stages of benefits casework: a task starts in a queue, gets picked up by a worker, may block on external dependencies (client or verification), may require supervisor review before completion, and can be escalated or cancelled at various points. Each of these stages has distinct SLA accountability, routing behavior, and access control requirements — which is why they are modeled as first-class states rather than sub-statuses or flags.

**States:** `pending`, `in_progress`, `awaiting_client`, `awaiting_verification`, `escalated`, `pending_review`, `completed`, `cancelled`

**Design decisions:**

- **Task state is an explicit field, not derived from timestamps or computed values.** Deriving state from timestamps is fragile — if `completedAt` is set but then cleared, what is the state? All major systems model task state explicitly. Explicit state is unambiguous and directly queryable.
- **`awaiting_client` and `awaiting_verification` are separate first-class states, not sub-reasons of a single `on_hold`.** Federal regulations treat client-caused and agency-caused delays differently for SLA accountability, resolution paths, and regulatory implications. ServiceNow collapses them into `on_hold` sub-reasons; first-class states enable distinct timer behavior and clearer federal reporting. Other vendors handle the same concepts:

  | Concept | Blueprint state | JSM | ServiceNow | Curam | Salesforce Gov Cloud | WS-HumanTask |
  |---|---|---|---|---|---|---|
  | Waiting for client action | `awaiting_client` | Waiting for Customer | On Hold / Awaiting Caller | Manual activity pending in inbox | Waiting on Someone Else | Suspended |
  | Waiting for third-party verification | `awaiting_verification` | Pending | On Hold / Awaiting Evidence | Suspended process | Deferred | Suspended |

- **Status values use snake_case.** Consistent with the blueprint's JSON API conventions and widely used in government API contexts (GitHub, Stack Exchange, Twitter). OpenAPI places no constraint on enum value casing; code generators map to language-appropriate forms (e.g., `InProgress` in TypeScript).
- **`cancelled` has a `reopen` transition that returns the task to `pending` with fresh routing.** Cancellation is sometimes an error, and supervisors need a way to reinstate a task without recreating it from scratch. Matches ServiceNow and Curam behavior.
- **`pending_review` is a dedicated state for structured supervisor sign-off before completion.** Quality control regulations in SNAP and Medicaid require supervisor approval before a determination is finalized. This is distinct from escalation — escalation is upward for help; review is a structured approval gate. A caseworker submits via `submit-for-review`; the supervisor either `approve`s (→ `completed`) or `return-to-worker`s (→ `in_progress`).
- **The SLA clock keeps running in `escalated` — urgency does not pause the agency's regulatory obligation.** Compare to `awaiting_client`, which pauses the clock because the delay is attributable to an external party.

**Customization points:**
- States can add their own status values via overlay (e.g., `awaiting_supervisor`).
- `slaClock` behavior per state can be overridden (e.g., a state may prefer to stop rather than pause the clock for `awaiting_client`, treating client delay as the client's time to spend).
- States needing tiered escalation (L1 → L2 → L3, as in JSM and ServiceNow) can add intermediate escalation states via overlay (e.g., `escalated_l2`, `escalated_supervisor`, `escalated_director`) with their own transitions and guards.

---

## SLA clock management

Each state in the state machine declares its effect on the SLA clock via a `slaClock` field. This declaration is consumed by the SLA engine (see [SLA types and clock management](#sla-types-and-clock-management)) when evaluating `pauseWhen`/`resumeWhen` conditions on every transition. The three values are: `running` (clock ticks normally), `paused` (clock is suspended; resumes from the same point when conditions clear), and `stopped` (clock halts permanently — used only for terminal states).

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

  | Concept | Blueprint | JSM | ServiceNow | Curam |
  |---|---|---|---|---|
  | Pause SLA | `slaClock: paused` on states with external dependencies | "Pending" status excludes from SLA timers | On Hold sub-reasons pause SLA | SLA tracked at process level, not task state |
  | Stop SLA | `slaClock: stopped` on terminal states | Resolved / Closed | Resolved / Closed / Canceled | Process completed / aborted |
  | Business hours | `calendarType` per timer transition | Configurable per SLA | Configurable per schedule | Configurable per deadline |

- **`pending_review` uses `slaClock: running` — supervisor review counts against the agency's deadline.** JSM and ServiceNow do not pause external SLA timers during approval states. States where regulation explicitly excludes review time from the deadline can override `slaClock` via overlay.

**Customization points:**
- States can override `slaClock` per state via overlay. A state that treats client non-response differently (e.g., stops rather than pauses) can do so without touching the baseline.
- The actual clock-pause/resume/stop logic is evaluated by the SLA engine on every transition using the `pauseWhen`/`resumeWhen` conditions in `*-sla-types.yaml` (see [SLA types and clock management](#sla-types-and-clock-management)). The `slaClock` value on each state declares the intent; the SLA engine reads the task's current state when evaluating those conditions.

---

## Transitions and effects

Transitions define valid state changes. Each transition has a trigger (the action that initiates the change, which becomes an RPC endpoint), optional guards (preconditions that must pass), and effects (side effects that execute when the transition fires). Effects are declarative — the state machine YAML specifies what should happen; the engine executes it.

**Effect types:**
- `set` — update fields on the resource (e.g., set `assignedToId` when claiming a task)
- `create` — write a record to another collection (e.g., create a domain event on every transition)
- `evaluate-rules` — invoke the rules engine to re-evaluate assignment or priority
- `event` — emit a named domain event with an optional data payload
- `when` — conditional wrapper on any effect; uses JSON Logic to decide whether the effect fires

Transitions can be actor-triggered (a human or system makes an API call) or timer-triggered (fire automatically when a duration elapses — see [Timer-triggered transitions](#timer-triggered-transitions)).

**Design decisions:**

- **Transitions use named RPC endpoints, not PATCH requests.** `claim` → `POST /tasks/:id/claim`. Each trigger maps cleanly to an audit event, can carry a request body (e.g., a cancellation reason), and can be independently guarded. PATCH endpoints require parsing the diff to determine what changed and whether it was allowed. Comparable systems:

  | Concept | Blueprint | JSM | ServiceNow | Camunda | WS-HumanTask |
  |---|---|---|---|---|---|
  | Transition trigger | Named trigger → RPC endpoint | Status transition button | State flow trigger | Sequence flow / signal | Claim, start, complete, skip operations |
  | Precondition | Guards (field/operator/value) | Validator condition | Condition script | Gateway condition | Constraints (potential owners, etc.) |
  | Side effect on transition | `set`, `create`, `evaluate-rules`, `event` effects | Post-function | Business Rule | Execution Listener | Task handler |
  | Conditional effect | `when` (JSON Logic) | — | Condition on Business Rule | Expression on Listener | — |

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

---

## Timer-triggered transitions

Timer transitions fire automatically when a duration elapses, without requiring an actor to make an API call. They cover regulatory deadline enforcement and client-response timeouts.

**Design decisions:**

- **`calendarType` is explicit per transition — calendar days for regulatory deadlines, business hours for staffing SLAs.** Conflating the two produces incorrect enforcement and federal reporting errors. Regulatory deadlines (SNAP 30-day determination) are calendar days; staffing SLAs are typically business hours. Setting the wrong type silently miscalculates deadlines. Comparable systems:

  | Concept | JSM | ServiceNow | Curam |
  |---|---|---|---|
  | Time-based transition | SLA timer → auto-transition on breach | Escalation rule with time condition | Deadline escalation on process |
  | Business vs. calendar time | Configurable per SLA | Configurable per schedule | Configurable per deadline |
  | Relative to deadline | SLA breach point | SLA breach point | Process deadline |

- **Timer transitions support `relativeTo: slaDeadline` with a negative duration, firing before the breach point.** Reacting only after a deadline is missed is too late. A `-48h` offset gives supervisors time to intervene. This is how JSM and ServiceNow are typically configured to prevent breaches rather than just record them.
- **On SLA warning, the timer transition fires a state change to `escalated`, not just a notification.** JSM issues an SLA warning notification without changing task status. ServiceNow auto-escalates on breach. We follow the ServiceNow model: the state change + domain event creates a clear audit trail, triggers assignment and priority re-evaluation, and makes the escalation visible in queue views — all without requiring a separate notification integration. States that prefer notification-only can remove this timer via overlay.
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

---

## Guards and access control

Guards are named preconditions on transitions. A transition only fires if all its guards pass.

**Design decisions:**

- **Compound conditions are expressed as `any`/`all` operators at the transition level, referencing named simple guards — not embedded logic inside guard definitions.** This keeps guard definitions readable (`field/operator/value`) and makes composition explicit and inspectable — consistent with how XState and similar declarative state machine systems handle compound preconditions. Comparable systems:

  | Concept | JSM | ServiceNow | Camunda | WS-HumanTask |
  |---|---|---|---|---|
  | Precondition | Validator (Groovy/JS) | Condition script (JS) | Expression language (JUEL/SpEL) | Deployment/routing constraints |
  | Role check | Project role condition | Role condition | Candidate group check | Potential owners list |
  | Compound condition | Multiple validators | Multiple conditions | Composite expression | — |

- **`callerIsSupervisor` is a named guard stub — RBAC will plug into this contract point when implemented.** `callerIsSupervisor` references `$caller.role`, which is the convention for what the [role-based access control](#role-based-access-control) service will expose. Until then, enforcement is at the service layer.
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

**We support:** simple `field/operator/value` guards; composition operators (`any`, `all`) at the transition level for OR/AND conditions across named guards.

**Customization points:**
- States can add guards to existing transitions via overlay (e.g., restrict `claim` to workers assigned to the correct program team).
- States can define additional named guards for their custom transitions.
- Once [role-based access control](#role-based-access-control) is implemented, `callerIsSupervisor` can be tightened to reference the real role model without changing transition definitions.

---

## Rules engine

Routing logic — which queue a task goes to, what priority it gets — varies enormously across states and program types. The rules engine separates this logic from the state machine so each can change independently.

**Design decisions:**

- **`workflow-rules.yaml` is entirely replaceable per state, separate from the state machine.** Routing logic varies significantly across states — entangling it with the state machine would make customization harder. A state drops in their own rules file without touching the state machine. JSM and ServiceNow similarly decouple automation rules from workflow status transitions:

  | Concept | JSM | ServiceNow | Camunda | WfMC |
  |---|---|---|---|---|
  | Routing rules | Automation rules | Assignment rules | Task listener / routing | Participant resolution |
  | Priority rules | Priority field automation | SLA-based priority | — | — |
  | Rule order | First matching automation | Rule processing order | — | — |

- **Rules use `first-match-wins` evaluation — simple, predictable, and easy to debug.** Rules are evaluated in order and the first match wins. States that need more complex routing (e.g., weighted load balancing) can implement that as a rule action.
- **Rules are invoked via `evaluate-rules` effects in the state machine — not embedded in rule definitions.** The state machine declares when rules run; the rules engine decides what happens. Neither system needs to understand the other's internals.
- **`escalate` uses `evaluate-rules: priority`, not `set priority: high`.** Hardcoding a priority value would break states with different escalation behavior per program. `evaluate-rules: priority` delegates the decision to the rules engine, which can apply different priority logic for expedited vs. standard cases. This is especially important in benefits processing, where SNAP expedited and standard cases have different deadline profiles.

**Customization points:**
- States replace `workflow-rules.yaml` entirely with their own assignment and priority rules.
- States can add `evaluate-rules` effects to additional transitions via overlay.

---

## Lifecycle hooks (`onCreate`, `onUpdate`)

Some effects need to fire in response to resource creation or field changes, not in response to a specific transition trigger. Lifecycle hooks handle these cases.

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

## Domain events

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

## Known gaps and future considerations

| Gap | Industry norm | Status |
|---|---|---|
| Batch/bulk transitions | Bulk reassignment common in queue management | Not in scope; likely a separate batch endpoint |
| Skill-based assignment | Round-robin, least-loaded, skill-match routing | Rules engine supports it; no built-in actions yet |
| Notification effects | Notify client on `await-client`; notify supervisor on escalation | Out of scope; cross-cutting concern (communication domain) |
| `$caller.role` enforcement | Role checks are named stubs; see [Role-based access control](#role-based-access-control) | Planned |
| SLA breach transition | ServiceNow fires a distinct breach escalation at 0h | Implemented: `auto-escalate-sla-breach` fires at `0h` relative to `slaDeadline`, emitting an `sla_breached` domain event for federal compliance reporting. |
| Cross-domain task creation | Application submitted → review task auto-created; see [Cross-domain event wiring](#cross-domain-event-wiring) | Planned |

---

## SLA types and clock management

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
- **`slaTypeCode` is an untyped string in the base contract — the valid enum is injected from `*-sla-types.yaml` at build time.** Hardcoding valid SLA type codes in the base OpenAPI spec would conflict with state overlays that add or replace types. The resolve pipeline will inject the correct enum at build time (issue #175).

**Customization points:**
- States will replace or extend SLA types via overlay once issue #174 lands.
- `pauseWhen` conditions can be tightened or loosened per regulatory interpretation — some states treat `awaiting_client` as the client's time to spend (stopping rather than pausing the clock) and can express that without touching the state machine.
- `autoAssignWhen` logic can be adjusted to match state-specific program routing criteria (e.g., attach `snap_expedited` when household income is below the expedited threshold, not just when `isExpedited` is set).

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

  | Concept | JSM | ServiceNow | IBM Curam | Salesforce Gov Cloud |
  |---|---|---|---|---|
  | Metric definitions | Custom gadgets + SLA reports | Performance Analytics indicators | MIS caseload reports | Reports + formula fields |
  | Stored vs. computed | Pre-aggregated dashboards | Pre-aggregated by PA data collector | Pre-computed batch reports | Pre-aggregated by reports engine |
  | Filter conditions | JQL (Jira Query Language) | Conditions (scripted or condition builder) | Fixed filter criteria on report type | SOQL filter criteria |
  | Event-pair duration | Pre-computed `resolutionDate - createdDate` field | Pre-computed duration field on task record | Pre-computed case duration field | Pre-computed formula field |
  | Performance targets | SLA goals on SLA agreements | PA thresholds with color-coding | Fixed targets in MIS | Report filter thresholds |
  | Dimensional breakdown | Filter by project/team | Breakdown by group or category | Fixed groupings in report | Report group-by |

- **Duration metrics are defined via `from`/`to` event pairs correlated by a `pairBy` field — not as pre-computed task fields.** Pre-computing duration as a task field requires deciding in advance which event pairs define "duration," locking in that decision at schema design time. The declarative model lets metric authors define new duration measurements without schema changes — any pair of events correlated by a shared field qualifies.
- **Performance `targets` are declared in the metric definition itself — not configured separately in a UI.** JSM puts goals on SLA agreements; ServiceNow puts thresholds on PA indicators — both in separate configuration surfaces. Declaring `targets` in the metric definition makes performance expectations visible to implementers at contract review time.
- **Dimensional breakdown is a query parameter (`groupBy`), not a property of the metric definition.** ServiceNow's PA breakdowns are baked into the indicator definition — modifying the definition to add a new view creates unnecessary coupling. `groupBy` as a query parameter allows any caller to slice any metric by any field without modifying the definition, consistent with how Grafana and Prometheus handle dimensions.
- **Pre-aggregation is an adapter-layer performance optimization, not a contract concern.** ServiceNow and JSM pre-aggregate metrics on a schedule for performance. For the blueprint's use case (development mock, contract definition), on-demand computation from live data is simpler, always current, and avoids a separate aggregation pipeline. States building production implementations will add pre-aggregation in their adapters — the metric definitions remain the same; only the computation strategy changes.

**Customization points:**
- States will replace or extend `workflow-metrics.yaml` via overlay once issue #174 lands.
- `targets` can be overridden to reflect state-specific performance goals.
- New metrics can be added for state-specific programs or reporting requirements.

---

## Role-based access control

> **Status: Planned.** Guards referencing `$caller.role` and `$caller.type` are named and wired. Enforcement is at the service layer until this capability is implemented.

The RBAC system provides the execution context values (`$caller.role`, `$caller.type`, `$caller.id`) that guards evaluate against. It is responsible for:

- Authenticating callers and resolving their role (caseworker, supervisor, system)
- Injecting caller context into the state machine execution environment
- Enforcing role checks declared in guard expressions

**Interface with the state machine:**

Guards reference caller context via `$caller.*` variables. The conventions used in the baseline:

| Variable | Expected values | Used in |
|---|---|---|
| `$caller.id` | UUID of the authenticated user or service account | `callerIsAssignedWorker` |
| `$caller.role` | `caseworker`, `supervisor`, `system` | `callerIsSupervisor`, `callerIsSystem` |

`system` is a valid role value rather than a separate `type` dimension. JSM and ServiceNow use roles or service accounts to distinguish automated callers — a separate type field adds a dimension without additional expressiveness.

**In the mock server**, caller context is supplied via request headers:
- `X-Caller-Id` — required for all state transitions; the caller's identifier
- `X-Caller-Role` — optional; values: `caseworker`, `supervisor`, `system`. Guards that check `$caller.role` (e.g., `callerIsSupervisor`) will fail if this header is omitted.

**In safety net benefits processing:**

Role separation is required by federal quality control regulations in SNAP and Medicaid. A caseworker cannot approve their own determination — that requires a supervisor. States are expected to define their own role hierarchy and map it to the `supervisor` value used in the guard, which may include roles like eligibility supervisor, unit manager, or quality control reviewer.

---

## Cross-domain event wiring

> **Status: Planned.** The domain events infrastructure is in place. The wiring that allows events from other domains to trigger workflow task creation is not yet implemented.

Cross-domain event wiring allows the workflow domain to react to events emitted by other domains — creating tasks automatically rather than requiring manual task creation via the API. It is responsible for:

- Subscribing to domain events from other domains (e.g., intake, case management, scheduling)
- Mapping incoming events to task creation payloads
- Triggering `onCreate` effects (assignment rules, priority rules, domain event emission) for each created task

**Interface with the state machine:**

Tasks created via cross-domain wiring go through the same `onCreate` lifecycle as manually created tasks — assignment and priority rules evaluate immediately, and a `task.created` domain event is emitted.

**In safety net benefits processing:**

Common cross-domain triggers that should automatically create workflow tasks:

| Triggering event | Domain | Task created |
|---|---|---|
| `application.submitted` | Intake | SNAP/Medicaid/TANF application review task |
| `application.submitted` (expedited) | Intake | Expedited SNAP review task (routed to expedited queue) |
| `case.recertification_due` | Case Management | Recertification review task |
| `appointment.no_show` | Scheduling | Follow-up outreach task |
| `document.received` | Document Management | Document review task (may resume `awaiting_client` task) |
| `verification.result_received` | External (IEVS/FDSH) | Triggers `system-resume` on existing `awaiting_verification` task |
