# Workflow Domain: Feature Design Reference

A feature-by-feature reference for the workflow contract architecture. For each capability, this document describes what the blueprint provides, how comparable systems handle the same problem, the trade-offs behind our design choices, and where states are expected to customize via overlays.

See [Workflow Domain](workflow.md) for the architecture overview and [Contract-Driven Architecture](../contract-driven-architecture.md) for the adapter pattern.

---

## Task lifecycle states

The task status enum defines the complete set of states a task can occupy. States are explicit fields on the Task resource — not derived from timestamps or other computed values. The state set was designed around the actual stages of benefits casework: a task starts in a queue, gets picked up by a worker, may block on external dependencies (client or verification), may require supervisor review before completion, and can be escalated or cancelled at various points. Each of these stages has distinct SLA accountability, routing behavior, and access control requirements — which is why they are modeled as first-class states rather than sub-statuses or flags.

**States:** `pending`, `in_progress`, `awaiting_client`, `awaiting_verification`, `escalated`, `pending_review`, `completed`, `cancelled`

The four non-obvious states — those with different behavior across vendors — map to the following industry concepts:

| Concept | Blueprint state | JSM | ServiceNow | Curam | Salesforce Gov Cloud | WS-HumanTask |
|---|---|---|---|---|---|---|
| Waiting for client action | `awaiting_client` | Waiting for Customer | On Hold / Awaiting Caller | Manual activity pending in inbox | Waiting on Someone Else | Suspended |
| Waiting for third-party verification | `awaiting_verification` | Pending | On Hold / Awaiting Evidence | Suspended process | Deferred | Suspended |
| Escalated | `escalated` | Escalated (built-in) | Custom via priority + routing | Supervisor queue routing | Custom escalation rule | — |
| Cancelled | `cancelled` | Cancelled (terminal) | Canceled (terminal) | Aborted process | Cancelled | Obsolete / Exited |

**In safety net benefits processing:**

| State | Typical use |
|---|---|
| `pending` | New SNAP application review task created when application is submitted; waiting in queue to be claimed |
| `in_progress` | Caseworker actively reviewing application documents, verifying income, conducting interview |
| `awaiting_client` | Caseworker requested additional documentation (pay stubs, proof of address, identity docs); task blocked until client responds |
| `awaiting_verification` | Caseworker queried IEVS or FDSH to verify income/employment; task blocked until verification service returns results |
| `escalated` | SNAP expedited case approaching 7-day deadline; supervisor notified to intervene |
| `pending_review` | Caseworker completed eligibility determination; supervisor must approve before benefits are authorized |
| `cancelled` | Client withdrew application; case closed administratively; duplicate task created in error |
| `completed` | Eligibility determination finalized — benefits approved, denied, or pended for further review |

**Design decisions:**

- **Explicit state over derived state.** All major systems model task state as an explicit field. Deriving state from timestamps (e.g., "if `completedAt` is set, status is completed") is fragile and makes transitions ambiguous.
- **Separate `awaiting_client` and `awaiting_verification` rather than a single `on_hold`.** These states have different SLA accountability (client delay vs. third-party delay), different resolution paths (client provides documents vs. verification service returns), and different regulatory implications. Federal regulations distinguish between client-caused and agency-caused processing delays for SLA purposes. ServiceNow collapses them into `on_hold` sub-reasons; we make them first-class states to improve clarity and enable distinct timer behavior.
- **Status values use snake_case.** Consistent with the blueprint's JSON API conventions and widely used in government API contexts (GitHub, Stack Exchange, Twitter). OpenAPI places no constraint on enum value casing; code generators map to language-appropriate forms (e.g., `InProgress` in TypeScript).
- **`cancelled` has a `reopen` transition.** Supervisor can reinstate a cancelled task to `pending`, re-evaluating assignment and priority rules on reopen. Matches ServiceNow and Curam behavior.
- **`pending_review` enables structured supervisor sign-off.** A caseworker submits their determination via `submit-for-review`; the supervisor either `approve`s (→ `completed`) or `return-to-worker`s (→ `in_progress`). Common in SNAP and Medicaid where quality control requirements mandate supervisor approval before a determination is finalized. This is distinct from escalation — escalation is upward for help; review is a structured approval gate.
- **`escalated` keeps SLA clock running.** Escalation signals urgency but does not pause the clock — the work is still the agency's responsibility. Compare to `awaiting_client` which pauses the clock because the delay is external.

**Customization points:**
- States can add their own status values via overlay (e.g., `awaiting_supervisor`, `returned`).
- `slaClock` behavior per state can be overridden (e.g., a state may prefer to stop rather than pause the clock for `awaiting_client`, treating client delay as the client's time to spend).
- States needing tiered escalation (L1 → L2 → L3, as in JSM and ServiceNow) can add intermediate escalation states via overlay (e.g., `escalated_l2`, `escalated_supervisor`, `escalated_director`) with their own transitions and guards.

---

## SLA clock management

Each state in the state machine declares its effect on the SLA clock via a `slaClock` field. This declaration is consumed by the SLA engine (see [SLA types and clock management](#sla-types-and-clock-management)) when evaluating `pauseWhen`/`resumeWhen` conditions on every transition. The three values are: `running` (clock ticks normally), `paused` (clock is suspended; resumes from the same point when conditions clear), and `stopped` (clock halts permanently — used only for terminal states).

**`slaClock` is required on every state** — omitting it creates ambiguity that leads to silent SLA miscalculations.

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

How comparable systems handle SLA clock state:

| Concept | Blueprint | JSM | ServiceNow | Curam |
|---|---|---|---|---|
| Pause SLA | `slaClock: paused` on states with external dependencies | "Pending" status excludes from SLA timers | On Hold sub-reasons pause SLA | SLA tracked at process level, not task state |
| Stop SLA | `slaClock: stopped` on terminal states | Resolved / Closed | Resolved / Closed / Canceled | Process completed / aborted |
| Business hours | `calendarType` per timer transition | Configurable per SLA | Configurable per schedule | Configurable per deadline |

**In safety net benefits processing:**

Federal and state regulations set processing deadlines that the SLA clock must reflect accurately:

- **SNAP**: 30 calendar days for standard applications; 7 calendar days for expedited. Clock runs from application receipt. Time spent waiting for client-provided documentation is typically excluded from the agency's deadline — making `awaiting_client: paused` the correct behavior under federal rules.
- **Medicaid**: 45 calendar days for most applications; 90 days for disability-based. States must document clock pause reasons for federal reporting.
- **TANF/Cash assistance**: Varies by state, typically 30–45 days. Some states use business days; the `calendarType` field on timer transitions accommodates this.

The distinction between `paused` (clock resumes from same point) and `stopped` (clock resets) matters for federal reporting — pausing preserves the original deadline, stopping would grant a fresh deadline on every block/resume cycle and distort SLA metrics.

**Design decisions:**

- **`slaClock` is required on every state.** Making it optional creates ambiguity — if a state has no `slaClock` value, is the clock running or stopped? Requiring explicit declaration forces intentional choices and prevents silent regressions when new states are added.
- **`paused` vs. `stopped` for waiting states.** `paused` means the clock resumes from where it left off. `stopped` means the clock resets. Paused is appropriate for external dependencies where the agency wants to reclaim that time. Stopped would effectively give the agency a fresh deadline on every block/resume cycle, which distorts SLA metrics and federal reporting.
- **`pending_review` clock runs during supervisor review.** Supervisor review time counts against the agency's deadline — the work is still in-flight from a regulatory standpoint. JSM and ServiceNow do not pause external SLA timers during approval states. States where regulation explicitly excludes review time from the deadline can override via overlay.

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

| Concept | Blueprint | JSM | ServiceNow | Camunda | WS-HumanTask |
|---|---|---|---|---|---|
| Transition trigger | Named trigger → RPC endpoint | Status transition button | State flow trigger | Sequence flow / signal | Claim, start, complete, skip operations |
| Precondition | Guards (field/operator/value) | Validator condition | Condition script | Gateway condition | Constraints (potential owners, etc.) |
| Side effect on transition | `set`, `create`, `evaluate-rules`, `event` effects | Post-function | Business Rule | Execution Listener | Task handler |
| Conditional effect | `when` (JSON Logic) | — | Condition on Business Rule | Expression on Listener | — |

**In safety net benefits processing:**

Common transition patterns in benefits casework:

| Trigger | Typical benefits scenario |
|---|---|
| `claim` | Caseworker picks up a SNAP application review task from the intake queue |
| `complete` | Caseworker finalizes eligibility determination with outcome (approved/denied/pended) |
| `await-client` | Caseworker sends an RFI (Request for Information) — e.g., missing pay stubs or ID documents |
| `await-verification` | Caseworker submits income query to IEVS or requests wage data from FDSH |
| `system-resume` | IEVS or FDSH returns verification results; task automatically unblocked |
| `escalate` | Expedited SNAP case approaching 7-day deadline; caseworker flags for supervisor |
| `submit-for-review` | Caseworker completes determination write-up and submits for supervisor quality review |
| `approve` | Supervisor signs off on determination; benefits authorized |
| `return-to-worker` | Supervisor identifies documentation gap or policy question; returns to caseworker |
| `cancel` | Client withdrawal received; application closed per client request |
| `reopen` | Supervisor reinstates erroneously cancelled task |

**Design decisions:**

- **Triggers become RPC endpoints.** `claim` → `POST /tasks/:id/claim`. This is explicit, discoverable, and maps cleanly to audit events. Contrast with PATCH-based state updates, which are harder to guard, audit, and extend with request bodies.
- **Effects are declarative.** The state machine YAML declares what happens; implementations execute it. This makes the contract inspectable and portable across adapter implementations.
- **`when` conditions use JSON Logic.** Already a project dependency (rules engine uses it). Consistent, evaluatable by tooling, and avoids introducing a scripting language.
- **`from` accepts a string or array of strings.** Some transitions logically originate from multiple states — `cancel` can fire from `pending`, `in_progress`, or `escalated`. Without array support, each source state requires a separate transition block with identical effects. Allowing `from: [pending, in_progress, escalated]` eliminates this duplication and makes multi-source transitions readable as a single entry.
- **`return-to-worker` returns to `in_progress`.** When a supervisor returns work for revision, the task stays with the same caseworker. Returning to `pending` would force an unnecessary re-claim and break the revision cycle — the same person who did the work should revise it.
- **`de-escalate` returns to `pending`.** De-escalation re-queues the task rather than returning it directly to `in_progress`. This handles both source cases cleanly: tasks escalated from `in_progress` (assigned worker) can be immediately re-claimed; tasks escalated from `pending` (no assigned worker) re-queue without leaving the task in an inconsistent `in_progress`-with-no-owner state. Consistent with `reopen → pending` and `release → pending`.
- **`reopen` returns to `pending`.** A cancelled task re-enters the queue rather than being assigned back to the original worker. Cancellation implies closure; reopen starts fresh, re-evaluating assignment and priority rules.
- **`cancel` requires supervisor authorization.** Workers cannot cancel tasks directly. Given the regulatory implications of closing a benefits application (federal reporting, client appeal rights), cancellation is restricted to supervisors. States that want a worker-initiated request with supervisor approval can model this via a custom `request-cancel` state.
- **No notification effect type.** Domain events are emitted on every transition (providing an integration hook), but there is no built-in `notify` effect. JSM, ServiceNow, and Curam all have built-in notification on escalation. States that need push notifications should build notification services that subscribe to domain events. A `notify` effect type is future work.

**Customization points:**
- States can add effects to existing transitions via overlay (e.g., send a notice to the client when `await-client` fires).
- States can add new transitions (e.g., a `pend` transition for applications requiring additional review before determination).

---

## Timer-triggered transitions

Timer transitions fire automatically when a duration elapses, without requiring an actor to make an API call. They cover regulatory deadline enforcement and client-response timeouts.

**We support:** `on: timer`, `after` (duration string), `relativeTo` (task field or `slaDeadline`), `calendarType: calendar | business`

| Concept | JSM | ServiceNow | Curam |
|---|---|---|---|
| Time-based transition | SLA timer → auto-transition on breach | Escalation rule with time condition | Deadline escalation on process |
| Business vs. calendar time | Configurable per SLA | Configurable per schedule | Configurable per deadline |
| Relative to deadline | SLA breach point | SLA breach point | Process deadline |

**Example timer transitions in the baseline:**

| Trigger | From | To | After | Relative to | Calendar type |
|---|---|---|---|---|---|
| `auto-escalate` | `pending` | `escalated` | 72h | `createdAt` | business |
| `auto-escalate-sla-warning` | `in_progress` | `escalated` | -48h | `slaDeadline` | calendar |
| `auto-cancel-awaiting-client` | `awaiting_client` | `cancelled` | 30d | `blockedAt` | calendar |
| `auto-resume-awaiting-verification` | `awaiting_verification` | `in_progress` | 7d | `blockedAt` | calendar |

**In safety net benefits processing:**

Timer triggers are especially important in benefits processing because regulatory deadlines are not advisory — missing them has federal compliance consequences:

- **SNAP standard (30 days)**: `auto-escalate-sla-warning` fires 48 hours before the SLA deadline so supervisors can intervene before a breach. `auto-escalate` fires if a task sits in `pending` for 72 business hours without being claimed.
- **SNAP expedited (7 days)**: States should configure a separate, shorter `auto-escalate` threshold for expedited tasks — e.g., 24 business hours. The baseline 72h value is a placeholder; overlay configuration is expected.
- **Client non-response (awaiting_client)**: Federal SNAP regulations allow agencies to close applications after 30 days of client non-response. `auto-cancel-awaiting-client` implements this automatically, with the domain event providing an audit trail for federal reporting.
- **Verification timeout (awaiting_verification)**: If IEVS or FDSH doesn't return results within 7 days, `auto-resume-awaiting-verification` unblocks the task so the caseworker can proceed with available information — consistent with policy that allows agencies to proceed without third-party data after reasonable waiting periods.

**Design decisions:**

- **`calendarType` is explicit per transition.** Regulatory deadlines (SNAP 30-day determination) are calendar days. Staffing SLAs are typically business hours. Conflating them produces incorrect enforcement and federal reporting errors.
- **`relativeTo: slaDeadline` enables proactive escalation.** Rather than only reacting after a deadline is missed, a negative duration (e.g., `-48h`) fires before the deadline. This is how JSM and ServiceNow prevent breaches rather than just recording them.
- **`auto-escalate-sla-warning` changes state rather than sending a notification.** JSM issues a notification for SLA warnings without changing task status. ServiceNow auto-escalates the record on breach. We follow the ServiceNow model — the state change + domain event creates a clear audit trail and triggers assignment/priority re-evaluation without requiring a separate notification integration. States that prefer notification-only can remove this timer via overlay.
- **Duration values in the baseline are illustrative.** The correct thresholds vary by program type, jurisdiction, and policy. All timer durations are expected to be overridden via state overlays.

**Customization points:**
- All `after` durations are overlay points — states set their own thresholds per program type and regulatory requirement.
- States should configure separate timer thresholds for expedited vs. standard cases (different SLA deadlines).
- `calendarType` can be overridden per transition.
- Timer transitions support an optional `guards` field for conditional suppression — e.g., skip `auto-escalate` for tasks already flagged by a supervisor.

---

## Guards and access control

Guards are named preconditions on transitions. A transition only fires if all its guards pass.

**We support:** simple `field/operator/value` guards; composition operators (`any`, `all`) at the transition level for OR/AND conditions across named guards.

| Concept | JSM | ServiceNow | Camunda | WS-HumanTask |
|---|---|---|---|---|
| Precondition | Validator (Groovy/JS) | Condition script (JS) | Expression language (JUEL/SpEL) | Deployment/routing constraints |
| Role check | Project role condition | Role condition | Candidate group check | Potential owners list |
| Compound condition | Multiple validators | Multiple conditions | Composite expression | — |

**Guard examples in the baseline:**

| Guard | Expression | Used on |
|---|---|---|
| `taskIsUnassigned` | `assignedToId is_null` | `claim` |
| `callerIsAssignedWorker` | `assignedToId == $caller.id` | `complete`, `release`, `await-client`, etc. |
| `callerIsSupervisor` | `$caller.role == supervisor` | `cancel`, `de-escalate`, `approve`, `return-to-worker` |
| `callerIsSystem` | `$caller.type == system` | `system-resume` |

Compound conditions use composition at the transition level rather than in the guard definition itself. For example, `escalate` uses `any: [callerIsAssignedWorker, callerIsSupervisor]` — keeping named guards simple and composable.

**In safety net benefits processing:**

Role separation is embedded in federal and state program regulations:

- **Caseworker vs. supervisor authority**: SNAP and Medicaid quality control requirements restrict who can authorize eligibility determinations. The `callerIsSupervisor` guard on `approve` enforces this at the contract level, so all adapter implementations enforce the same boundary regardless of the underlying technology.
- **Automated verification systems**: IEVS, FDSH, and state data hubs (e.g., state wage records, SOLQ for SSA data) operate as system actors — they are not human caseworkers. The `callerIsSystem` guard on `system-resume` explicitly distinguishes automated verification callbacks from human actions, which is important for audit trails and federal reporting.
- **Self-assignment control**: `taskIsUnassigned` on `claim` prevents multiple caseworkers from simultaneously claiming the same task — a common issue in queue-based benefits processing without it.

**Design decisions:**

- **Guard composition over embedded expressions.** Rather than embedding JSON Logic inside guard definitions, compound conditions are expressed as `any`/`all` operators at the transition level, composing named simple guards. This keeps guard definitions readable (`field/operator/value`) and makes composition explicit and inspectable at the transition — consistent with how XState and similar declarative state machine systems handle compound preconditions.
- **`callerIsSupervisor` is a stub.** The guard references `$caller.role`, which is a convention for what the [role-based access control](#role-based-access-control) service will expose. Until then, enforcement is at the service layer. The guard is named and wired so implementations know where to plug in.
- **`callerIsSystem` enables automated verification resumption.** Benefits processing relies on external verification services (IEVS, FDSH, state data hubs) that return results asynchronously. A separate `system-resume` trigger (rather than relaxing the human `resume` guard) keeps domain events distinguishable and allows the request body to carry verification result data (source, result summary).
- **Named guards are reusable.** Defining guards at the top of the state machine and referencing them by name on transitions avoids duplicating conditions and makes the intent legible.
- **`await-client` and `await-verification` are caseworker-only.** Putting a task into a waiting state reflects a caseworker's knowledge of the case. Supervisors who need to block a task can reassign it, or states can add `callerIsSupervisor` to these guards via overlay.
- **Guards are per-transition, not per-state.** There is no way to declare "any transition into `pending_review` requires supervisor." Each transition must include its own guards. This is standard for declarative state machines but requires discipline when adding new transitions — a missing guard is a silent gap in access control. A future schema enhancement (`entryGuards` on states) could enforce this at the contract level.

**Customization points:**
- States can add guards to existing transitions via overlay (e.g., restrict `claim` to workers assigned to the correct program team).
- States can define additional named guards for their custom transitions.
- Once [role-based access control](#role-based-access-control) is implemented, `callerIsSupervisor` can be tightened to reference the real role model without changing transition definitions.

---

## Rules engine

Rules determine task routing (assignment) and prioritization without hardcoding logic in the state machine. They are evaluated by `evaluate-rules` effects.

**We support:** `assignment` and `priority` rule sets; JSON Logic conditions; `first-match-wins` evaluation; `evaluate-rules` effect with `ruleType`

| Concept | JSM | ServiceNow | Camunda | WfMC |
|---|---|---|---|---|
| Routing rules | Automation rules | Assignment rules | Task listener / routing | Participant resolution |
| Priority rules | Priority field automation | SLA-based priority | — | — |
| Rule order | First matching automation | Rule processing order | — | — |

**In safety net benefits processing:**

Assignment and priority rules encode program-specific routing logic that varies significantly across states and program types:

- **Assignment rules**: Route SNAP tasks to the SNAP intake queue, Medicaid tasks to the Medicaid eligibility queue, and TANF tasks to the cash assistance queue. Expedited SNAP applications may route to a dedicated expedited queue staffed for 7-day processing. Complex cases (e.g., households with multiple programs) may route to a specialized multi-program team.
- **Priority rules**: Set `priority: expedited` when `isExpedited == true` (7-day SNAP clock). Set `priority: high` for cases approaching their SLA deadline. Set `priority: normal` as default. States commonly add program-specific priority logic — e.g., prioritizing cases with young children or disability flags.
- **Re-evaluation triggers**: Rules re-evaluate on `onCreate` (initial routing), `release` (task returned to queue), `escalate` (priority may change), and `onUpdate` for `isExpedited` field changes (e.g., a supervisor marks a standard case as expedited after submission).

**Design decisions:**

- **Rules live in a separate YAML file, not inline in the state machine.** `workflow-rules.yaml` is entirely replaceable per state. This makes state customization straightforward — a state drops in their own rules file without touching the state machine.
- **`first-match-wins`.** Simple, predictable, and easy to debug. Rules are evaluated in `order` and the first match wins. States that need more complex routing (e.g., weighted load balancing) can implement that as a rule action.
- **`evaluate-rules` is called from the state machine, not from rules.** The state machine declares when rules run (`onCreate`, `release`, `escalate`); the rules engine decides what happens. This keeps the two concerns cleanly separated.
- **Rules are not hardcoded effects.** `evaluate-rules: priority` on `escalate` lets the rules engine decide what escalation means for priority — rather than hardcoding `set priority: high`. A state serving both standard and expedited cases may want different escalation priority behavior per program.

**Customization points:**
- States replace `workflow-rules.yaml` entirely with their own assignment and priority rules.
- States can add `evaluate-rules` effects to additional transitions via overlay.

---

## Lifecycle hooks (`onCreate`, `onUpdate`)

Lifecycle hooks fire effects at key moments in the object's life independent of any specific transition. They handle setup and maintenance concerns that aren't naturally attached to a single transition trigger — for example, initializing SLA tracking when a task is created, or re-routing a task when a supervisor changes its program type outside of a transition.

**Hook types:**
- `onCreate` — fires when a new resource is created; used to initialize state (SLA entries, queue assignment, priority)
- `onUpdate` — fires when specific fields change on an existing resource; scoped by a `fields` filter to avoid firing on every PATCH

| Concept | Blueprint | JSM | ServiceNow | Camunda | BPMN |
|---|---|---|---|---|---|
| On creation | `onCreate` | — | Business Rule on insert | Start event listener | Start event |
| On field change | `onUpdate` (scoped by `fields`) | — | Business Rule on update | Execution listener on variable change | Data Object change event |

**In safety net benefits processing:**

- **`onCreate`**: When a new task is created (e.g., triggered by application submission via [cross-domain event wiring](#cross-domain-event-wiring)), assignment and priority rules evaluate immediately so the task lands in the right queue with the right priority before any caseworker sees it.
- **`onUpdate` for `isExpedited`**: If a supervisor manually flags a task as expedited after initial routing (e.g., a client reveals a crisis situation), `onUpdate` re-evaluates priority rules and potentially re-routes the task to the expedited queue — without requiring a state transition.
- **`onUpdate` for `programType`**: If a task's program type is corrected (e.g., application was initially categorized as SNAP but is actually a combined SNAP/Medicaid application), assignment rules re-evaluate to route to the correct team.

**Design decisions:**

- **`onUpdate` has a `fields` filter.** Without scoping, `onUpdate` fires on every PATCH, including updates made by transitions themselves — creating potential loops. The `fields` list explicitly declares which field changes have downstream effects, which also serves as documentation.
- **`onUpdate` fires on external updates only.** Transition-driven field changes (e.g., `set assignedToId` on `claim`) do not trigger `onUpdate`. This prevents cascading re-evaluation during transitions.

**Customization points:**
- States can add `onUpdate` effects via overlay (e.g., send a supervisor alert when `priority` changes to `expedited`).
- States can extend the `fields` list to react to additional field changes.

---

## Domain events

Every state machine transition and lifecycle hook emits an immutable domain event via the `event` effect. Events are the audit trail and the integration surface for cross-domain communication.

**We support:** `event` effect type with `action` and optional `data` payload; read-only Events API (`GET /events`, `GET /events/stream` SSE, `GET /events/:id`)

| Concept | JSM | ServiceNow | Camunda | WfMC |
|---|---|---|---|---|
| Transition audit | Issue history | Audit log | User Operation Log | Task Event History |
| Real-time stream | Webhooks | Event Management | Process event stream | — |
| Immutable log | Read-only history | Read-only audit | History service | — |

**In safety net benefits processing:**

Domain events serve two roles in benefits programs: audit trail and cross-domain integration.

- **Audit trail**: Federal and state regulations require documentation of eligibility determinations, including who acted, when, and why. Events like `task.approved`, `task.cancelled` (with reason), and `task.system_resumed` (with source and result) provide the granular record needed for quality control reviews, federal audits, and fair hearings.
- **Cross-domain integration** (via [cross-domain event wiring](#cross-domain-event-wiring)): `task.completed` consumed by the eligibility domain to trigger benefit issuance. `task.awaiting_client` consumed by the communication domain to send an RFI notice to the client. `task.auto_cancelled` consumed by the case management domain to update case status.
- **Real-time supervisor dashboards**: The SSE stream (`GET /events/stream`) allows supervisor workload dashboards to update in real time as tasks are claimed, escalated, or completed — without polling.

**Design decisions:**

- **Single events collection across all domains.** Events are identified by `domain`, `resource`, and `action`. This makes cross-domain queries possible (e.g., "show all events for this person across case management and workflow") without joining separate event stores.
- **Read-only API.** Events are never POST'd, PATCH'd, or DELETE'd via the API. Mutations to the audit trail are not permitted.
- **`event` effects declare the action name and data.** The state machine YAML is the authoritative source for what events exist and what they carry. Implementations derive event schema from the contract.

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
| SLA breach transition | ServiceNow fires a distinct breach escalation at 0h | `slaInfo.*.status` becomes `breached` via the SLA engine; no timer-triggered state machine transition fires at the breach moment. A future `auto-escalate-sla-breach` timer would add a domain event for federal breach reporting. |
| Cross-domain task creation | Application submitted → review task auto-created; see [Cross-domain event wiring](#cross-domain-event-wiring) | Planned |

---

## SLA types and clock management

SLA types define program-specific processing deadlines and the conditions under which the clock pauses or resumes. They are declared in a separate `*-sla-types.yaml` file, independent of the state machine.

**We support:** `*-sla-types.yaml` per domain; `autoAssignWhen` (JSON Logic condition evaluated at creation); `pauseWhen` / `resumeWhen` (JSON Logic conditions evaluated on every transition); `warningThresholdPercent` (percentage of deadline elapsed before status → `warning`)

| Concept | JSM | ServiceNow | IBM Curam | Salesforce Gov Cloud |
|---|---|---|---|---|
| SLA definition | SLA agreement (separate record) | SLA Definition (separate record) | Process deadline on case | Milestone on entitlement |
| Multiple SLAs per record | Yes — multiple agreements can apply | Yes — multiple SLA records can attach | Typically one deadline per process | Multiple milestones per case |
| Auto-attach conditions | Automation rule conditions | SLA Definition conditions (scripted/GUI) | Configured at process design time | Entitlement criteria |
| Pause/resume | "Pending" sub-status excludes from timer | On-hold condition scripts | Not granular; handled at process level | Milestone pause conditions |
| Warning before breach | Warning percentage on SLA agreement | Warning threshold on SLA Definition | Not built-in | Milestone warning time |

**Baseline SLA types in `workflow-sla-types.yaml`:**

| SLA type | Duration | Warning threshold | Pauses when |
|---|---|---|---|
| `snap_expedited` | 7 days | 75% elapsed | `awaiting_client` or `awaiting_verification` |
| `snap_standard` | 30 days | 75% elapsed | `awaiting_client` or `awaiting_verification` |
| `medicaid_standard` | 45 days | 75% elapsed | `awaiting_client` or `awaiting_verification` |
| `medicaid_disability` | 90 days | 75% elapsed | `awaiting_client` or `awaiting_verification` |

**In safety net benefits processing:**

Federal regulations require accurate accounting of processing time. The SNAP regulations explicitly distinguish between time the agency is responsible for and time attributable to client non-response or third-party verification delays — making pause vs. stop behavior a compliance question, not just a design preference.

| Program | Standard deadline | Expedited deadline |
|---|---|---|
| SNAP | 30 calendar days | 7 calendar days |
| Medicaid | 45 calendar days (90 for disability) | — |
| TANF / Cash assistance | Varies by state (typically 30–45 days) | — |
| CHIP | 45 calendar days | — |

**Design decisions:**

- **SLA types in a separate file, not inline in the state machine.** JSM and ServiceNow store SLA definitions as separate database records — decoupled from workflow configuration. We follow that model: `*-sla-types.yaml` is independently replaceable per state without touching the state machine. A state with different program mixes (e.g., CHIP-heavy) can drop in their own types file. This is a direct extensibility choice over embedding deadlines as constants in the state machine.
- **Multiple SLA types per task, not one.** A single task may be subject to both an expedited and a standard SLA deadline depending on how it is classified. JSM and ServiceNow both support multiple SLA records per work item. IBM Curam's single-deadline-per-process model is less flexible for multi-program tasks. We follow the JSM/ServiceNow pattern.
- **`autoAssignWhen` uses JSON Logic evaluated at task creation.** ServiceNow auto-attaches SLA records based on conditions defined on the SLA Definition. JSM uses automation rules. We use JSON Logic for consistency with the rest of the behavioral engine — no second condition language. `isExpedited == true` on the task causes `snap_expedited` to attach automatically.
- **`pauseWhen` / `resumeWhen` use JSON Logic, not state-based declarations.** The [SLA clock management](#sla-clock-management) section declares intent (`slaClock: paused` on states). The SLA types layer is the enforcement mechanism. We chose JSON Logic conditions rather than hardcoding a list of states for two reasons: (1) different SLA types can have different pause behavior on the same state — a state might pause `snap_standard` but not `snap_expedited` during `awaiting_client`; (2) states can override pause behavior without modifying the state machine. ServiceNow's on-hold conditions work the same way — scripted conditions rather than a fixed state mapping.
- **`pauseWhen` pauses rather than stops the clock.** Pausing preserves the original deadline and resumes from the same point. Stopping would grant a fresh deadline window on each block/resume cycle — distorting federal SLA reporting. Federal SNAP regulations treat client-caused delays as excluded time, not time that resets the agency's clock. JSM and ServiceNow default to pause (accumulated time preserved) for the same reason.
- **`warningThresholdPercent` is a percentage, not a fixed offset.** A fixed offset (e.g., "2 days before deadline") would need a different value per SLA type — 2 days before a 7-day deadline is much more urgent than 2 days before a 90-day deadline. A percentage scales correctly: 75% of 7 days ≈ 5.25 days; 75% of 90 days = 67.5 days. ServiceNow uses the same percentage model on SLA Definitions.
- **`slaTypeCode` is an untyped string in the base OpenAPI contract.** The valid enum of codes comes from `*-sla-types.yaml`, which varies by state. Hardcoding the enum in the base spec would conflict with state overlays that add or replace SLA types. The resolve pipeline will inject the correct enum from the types file at build time (issue #175) — same pattern used elsewhere for overlay-driven enum injection.

**Customization points:**
- States will replace or extend SLA types via overlay once issue #174 lands.
- `pauseWhen` conditions can be tightened or loosened per regulatory interpretation — some states treat `awaiting_client` as the client's time to spend (stopping rather than pausing the clock) and can express that without touching the state machine.
- `autoAssignWhen` logic can be adjusted to match state-specific program routing criteria (e.g., attach `snap_expedited` when household income is below the expedited threshold, not just when `isExpedited` is set).

---

## Metrics

Operational metrics are defined as behavioral contract artifacts (`workflow-metrics.yaml`) and served as part of the workflow API (`GET /workflow/metrics`, `GET /workflow/metrics/{metricId}`). They are computed on demand from live task and event data — not pre-aggregated or stored separately.

**We support:** `count`, `ratio`, and `duration` aggregate types; JSON Logic `filter` conditions on source data; `pairBy` for correlating event pairs in duration metrics; `targets` for declaring performance expectations; `groupBy` query parameter for dimensional breakdown; time-window and field filters

| Concept | JSM | ServiceNow | IBM Curam | Salesforce Gov Cloud |
|---|---|---|---|---|
| Metric definitions | Custom gadgets + SLA reports | Performance Analytics indicators | MIS caseload reports | Reports + formula fields |
| Stored vs. computed | Pre-aggregated dashboards | Pre-aggregated by PA data collector | Pre-computed batch reports | Pre-aggregated by reports engine |
| Filter conditions | JQL (Jira Query Language) | Conditions (scripted or condition builder) | Fixed filter criteria on report type | SOQL filter criteria |
| Event-pair duration | Pre-computed `resolutionDate - createdDate` field | Pre-computed duration field on task record | Pre-computed case duration field | Pre-computed formula field |
| Performance targets | SLA goals on SLA agreements | PA thresholds with color-coding | Fixed targets in MIS | Report filter thresholds |
| Dimensional breakdown | Filter by project/team | Breakdown by group or category | Fixed groupings in report | Report group-by |

**Baseline metrics in `workflow-metrics.yaml`:**

| Metric | Aggregate | Measures |
|---|---|---|
| `task_time_to_claim` | duration | Median time from task creation to first claim event |
| `tasks_in_queue` | count | Tasks currently in `pending` status |
| `release_rate` | ratio | Release events as a fraction of total task transitions |
| `sla_breach_rate` | ratio | Tasks with at least one breached SLA entry |
| `sla_warning_rate` | ratio | Auto-escalate-sla-warning events as a fraction of total transitions |

**In safety net benefits processing:**

Federal and state programs use operational metrics to monitor regulatory compliance (SLA breach rates, processing time distribution) and manage staff workload (queue depth trends, release rates). States typically report aggregate metrics to federal partners annually. Defining metrics as contract artifacts alongside the state machine and rules makes measurement definitions explicit, portable, and auditable — rather than buried in dashboard configuration.

**Design decisions:**

- **Metrics as YAML artifacts, not dashboard configuration.** All major systems (JSM, ServiceNow, Salesforce) define metrics through a GUI that stores definitions in a proprietary database — non-portable and hard to version-control. We define metrics as contract artifacts alongside the state machine and rules. This is a deliberate departure from industry norms, motivated by the blueprint's goal of making behavioral contracts explicit and portable across state implementations.
- **Decomposed source + aggregate model.** Rather than naming specific metrics with hardcoded computation logic, each metric is a combination of a `collection`, a JSON Logic `filter`, and an `aggregate` type. Adding a new metric is always a data-definition problem, not a code problem. IBM Curam ties each metric to a fixed report type — adding a new metric often requires custom development. Our model lets states define metrics declaratively without writing server-side code.
- **JSON Logic for filter conditions.** JSM uses JQL; ServiceNow uses condition scripts; Salesforce uses SOQL. We use JSON Logic — the same evaluator used for state machine guards and rules — so there is no second filter language to learn and metric filters can be validated by the same tooling. The trade-off is expressiveness: JSON Logic is less powerful than SQL. For the patterns needed here (filter by field value, check array membership), it is sufficient.
- **Declarative `from`/`to` event pairing for duration metrics.** Most systems pre-compute duration as a field on the task record (e.g., `resolutionDate - createdDate`), which requires deciding in advance which event pairs define "duration." Our declarative `from`/`to` + `pairBy` model lets metric authors define new duration measurements without schema changes — any pair of events correlated by a shared field qualifies. This preserves flexibility as states add new transition types.
- **`targets` declared in the metric definition.** Performance targets (e.g., median time to claim < 4 hours) are declared alongside the metric, not in a separate configuration UI. JSM puts goals on SLA agreements; ServiceNow puts thresholds on PA indicators. Embedding targets in the contract makes the definition of "healthy" explicit, version-controlled, and visible to implementers.
- **`groupBy` is a query parameter, not part of the metric definition.** ServiceNow's PA breakdowns are baked into the indicator definition — adding a new breakdown dimension requires modifying the indicator. Our `groupBy` query parameter allows any caller to slice any metric by any field without modifying the definition. Consistent with how Grafana and Prometheus handle dimensions.
- **Computed on demand, not pre-aggregated.** ServiceNow and JSM pre-aggregate metrics on a schedule for performance. For the blueprint's use case (development mock, contract definition), on-demand computation from live data is simpler, always current, and avoids a separate aggregation pipeline. States building production implementations will add pre-aggregation in their adapters — the metric definitions remain the same; only the computation strategy changes.

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
