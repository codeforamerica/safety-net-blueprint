# Scheduling Service

This document is the architecture reference for the scheduling service — a blueprint-defined contract boundary that delivers time-based event callbacks. Platforms compared: AWS EventBridge Scheduler, Google Cloud Tasks, Azure Durable Functions, Quartz/Spring, Temporal.

## Overview

The scheduling service accepts timer requests and fires callback events when timers expire. It is not a blueprint-owned domain — each state implements it using their infrastructure of choice. A domain state machine emits a timer request with a deterministic ID, a fire time, and the callback event to deliver; the service fires that event when the time comes. The scheduling service is a dumb relay: it passes the caller-specified callback event through unchanged and adds only the original timer ID to the payload.

## What the scheduling service does

1. A domain object reaches a state or transition that requires a time-based follow-up — for example, a task created but not completed within the regulatory processing deadline.
2. The state machine emits a timer request specifying a deterministic ID, when to fire, and what event to deliver when the timer expires.
3. The scheduling service registers the timer using the ID as the cancellation key. A duplicate request with the same ID is treated as a no-op — the existing timer is not replaced.
4. When the timer expires, the scheduling service emits the callback event exactly as specified in the original request. It passes the caller-provided data through unchanged and adds the original timer ID to the payload.
5. The domain state machine receives the callback event by name, exactly as it receives any other domain event, and runs the associated steps.
6. If the object is resolved before the timer fires — the task is completed, the application is withdrawn — the state machine emits a cancellation event referencing the same timer ID. The scheduling service cancels the pending timer; if the timer has already fired, the cancellation is a no-op.

## Event contract

### Request a timer

```
Event: scheduling.timer.requested
```

| Field | Type | Description |
|---|---|---|
| `timerId` | string | Deterministic identifier for this timer. See [Decision 2](#decision-2-predictable-timer-ids). |
| `fireAfter` | ISO 8601 duration | How long to wait before firing the callback (e.g., `PT72H`, `P30D`). Mutually exclusive with `fireAt`. |
| `fireAt` | ISO 8601 timestamp | Absolute time to fire the callback. Use when the fire time is a known deadline stored on the object. Mutually exclusive with `fireAfter`. |
| `fireOffset` | ISO 8601 duration (negative) | Adjustment applied to `fireAt`. Used to fire before the target time — e.g., `-PT48H` fires 48 hours before the `fireAt` timestamp. Only valid when `fireAt` is set. |
| `calendarType` | string | Optional. `business` counts only business days when evaluating `fireAfter`. When omitted, calendar days are used. |
| `callback.event` | string | CloudEvents type of the event to fire when the timer expires. See [Decision 3](#decision-3-timer-types-as-named-domain-events). |
| `callback.data` | object | Data payload to include in the callback event. Passed through unchanged; `timerId` is added by the scheduling service. |

### Cancel a timer

```
Event: scheduling.timer.cancelled
```

| Field | Type | Description |
|---|---|---|
| `timerId` | string | The timer to cancel. If the timer has already fired or does not exist, this is a no-op. |

### Callback delivery

The scheduling service emits the caller-specified callback event when the timer expires. It passes `callback.data` through unchanged and adds `timerId` to the payload. No other fields are added or derived. The receiving machine subscribes to the callback event by name, exactly as it subscribes to any other domain event.

The callback payload schema is `TimerCallbackEvent` in `schemas/platform-events.yaml`. The only guaranteed field is `timerId`; any additional fields come from `callback.data` in the original request.

## Declaring timers in state machines

Domain state machine files declare their timer types in a `timers:` section at the machine level. Each entry has a short identifier — the full event name is `{domain}.{id}` by convention. This makes each timer type a named domain event declared alongside the state machine that uses it.

```yaml
timers:
  - id: snap_deadline
    description: 30-calendar-day SNAP processing deadline
  - id: interview_reminder
    description: Interview reminder sent 48 hours before the scheduled interview
```

The state machine subscribes to each timer event by its full name:

```yaml
events:
  - name: intake.snap_deadline
    steps:
      - call: {POST: intake/applications/$this.subject/auto-deny, body: {reason: snap_deadline_exceeded}}
```

Timers are scheduled and cancelled using the shared `requestTimer` and `cancelTimer` procedures:

```yaml
- call: requestTimer
  with:
    timerId: '"intake.snap_deadline." + $object.id'
    fireAfter: P30D
    calendarType: calendar
    callback: {event: '"intake.snap_deadline"', data: {}}
- call: cancelTimer
  with: {timerId: '"intake.snap_deadline." + $object.id'}
```

## Key design decisions

| # | Decision | Summary |
|---|---|---|
| 1 | [Event-based contract boundary](#decision-1-event-based-contract-boundary) | Timer requests and cancellations are domain events, keeping the scheduling service decoupled from the runtime and consistent with the fully event-driven model. |
| 2 | [Predictable timer IDs](#decision-2-predictable-timer-ids) | Timer IDs are deterministic in `domain.timerType.objectId` format, making cancellation idempotent and timer behavior testable without inspecting event logs. |
| 3 | [Timer types as named domain events](#decision-3-timer-types-as-named-domain-events) | Each timer type is a named domain event. The scheduling service is a pure relay — it passes the caller-specified callback event through unchanged and does not derive or infer timer types. |

---

### Decision 1: Event-based contract boundary

**Status:** Decided: B

**What's being decided:** Whether the scheduling service is invoked by a REST API call or a domain event, and what that means for how decoupled the state machine execution model is from the timer implementation.

**Considerations:**
- The state machine execution model is fully event-driven — every trigger (creation, field change, external event, timer) arrives as a named event. A REST API for timer requests would require a different invocation path for timers alone, breaking the consistency of the execution model.
- Major scheduling infrastructure (AWS EventBridge, Azure Service Bus, Google Cloud Pub/Sub) supports event-triggered scheduling. An event-based boundary lets states bridge to whichever backend they use without exposing implementation details to the blueprint.
- Cancellation can be expressed as an event (`scheduling.timer.cancelled`), keeping the model event-driven throughout rather than requiring a separate REST DELETE.

**Options:**
- **(A)** REST API — `POST /timers` and `DELETE /timers/{timerId}`. Familiar and directly debuggable, but inconsistent with the event-driven execution model.
- **(B) ✓** Event-based — `scheduling.timer.requested` and `scheduling.timer.cancelled`. Consistent with the fully event-driven model; states bridge to their scheduling backend of choice.

---

### Decision 2: Predictable timer IDs

**Status:** Decided: B

**What's being decided:** Whether timer IDs are random (UUID-based) or deterministic, and what format they follow.

**Considerations:**
- Random UUIDs require the caller to store and track the timer ID after registration in order to cancel or test it. Deterministic IDs can be reconstructed from known values — the domain, timer type, and object ID — without any storage.
- Deterministic IDs make cancellation safe to call idempotently: the state machine can cancel a timer without knowing whether it was ever registered. This matters during state machine retries or replay.
- Testing timer behavior requires knowing the timer ID to set up stubs. Deterministic IDs are constructable from the object ID, which test authors already know. UUID-based IDs require inspecting event logs to find the ID first.
- The format `domain.timerType.objectId` (e.g., `workflow.creation_deadline.task-123`) encodes context directly in the ID, making logs readable without additional lookup.

**Options:**
- **(A)** UUID-based IDs — simple to generate, but not reconstructible; cancellation and testing require ID storage.
- **(B) ✓** Deterministic IDs in `domain.timerType.objectId` format — constructable from known values, idempotent cancellation, testable without log inspection.

---

### Decision 3: Timer types as named domain events

**Status:** Decided: B

**What's being decided:** Whether each timer type is a separate named domain event (subscribed to directly by name), or whether all timer callbacks arrive on a single generic event that machines dispatch on a `timerType` field — and whether `timerType` is supplied by the caller or derived by the scheduling service.

**Considerations:**
- AWS EventBridge Scheduler, Google Cloud Tasks, Azure Durable Functions, Quartz/Spring, and Temporal all implement pure pass-through for timer callbacks. The caller specifies exactly what to fire or deliver when the timer expires; the scheduler relays it unchanged. No major platform derives a type field from the timer ID or adds metadata beyond what the caller requested.
- A single generic event with a `timerType` field requires every machine that handles timers to implement a dispatch step. Named events eliminate this boilerplate — each event subscription handles exactly one timer type, the same way every other event subscription works.
- Named events make the catalog explicit: each timer type is a declared event, not an unnamed field value. This is consistent with how all other machine event subscriptions work and makes state machine contracts self-documenting.
- When timer types are separate named events, each domain declares its own timers in the state machine `timers:` section. The event name follows the convention `{domain}.{id}`, avoiding collisions across domains.

**Options:**
- **(A)** Single generic event (`scheduler.timer.fired`) with a `timerType` field — fewer catalog entries, but requires dispatch logic in every machine and a non-standard field added by the scheduling service.
- **(B) ✓** Named events per timer type — each timer type is a named domain event, the scheduling service is a pure relay, and subscriptions are per-type with no dispatch step needed.

**Decision:** Named events per timer type (B). The scheduling service passes the caller-specified callback event name through unchanged. It does not derive, infer, or annotate any type information from the timer ID. This is consistent with how AWS EventBridge Scheduler, Google Cloud Tasks, Azure Durable Functions, and Quartz all work.

---

## Implementation guidance

States implement the scheduling service using their infrastructure of choice:

| Infrastructure | Approach |
|---|---|
| AWS EventBridge Scheduler | Create a one-time schedule with `timerId` as the schedule name. Target an EventBridge bus with the callback event type and payload. Cancel by deleting the schedule by name. |
| Quartz / Spring | Schedule a one-time job with `timerId` as the job key. Store the callback event type and payload in the JobDataMap. Fire the callback event from the job. Cancel by unscheduling the job key. |
| Azure Durable Functions | Use durable timers. Store the callback specification in orchestration state. Cancel using the instance ID derived from `timerId`. |
| Cron / database | Store pending timers with fire time, callback event type, and callback payload. A polling job queries for due timers, fires the callback events, and marks them as fired. Cancellation deletes the row. |

The scheduling service must be idempotent for timer requests with the same `timerId` — a duplicate request must not create a second timer.

## Shared procedures

Two shared procedures in `platform-state-machine.yaml` are inherited by all domain state machine files via `extends:`:

- `requestTimer` — emits `scheduling.timer.requested` with the full timer structure
- `cancelTimer` — emits `scheduling.timer.cancelled`

Domain and machine-level procedures with the same id override the platform definitions.

## References

- [Behavioral Contract DSL — Timer design](behavioral-contract-dsl.md#timer-design)
- [ISO 8601 Duration format](https://en.wikipedia.org/wiki/ISO_8601#Durations)
- [CloudEvents specification](https://cloudevents.io/)
- `schemas/platform-events.yaml` — `SchedulingTimerRequestedEvent`, `SchedulingTimerCancelledEvent`, `TimerCallbackEvent`
- `platform-state-machine.yaml` — `requestTimer`, `cancelTimer` shared procedures
