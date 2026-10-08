# Published Events

Auto-generated from state machine `emit` and subscription declarations.

| Event | Published by | Subscribers |
|---|---|---|
| `eligibility.determination.complete` | [Eligibility/Determination](eligibility.md) | *(none)* |
| `intake.application.closed` | [Intake/Application](intake.md) | *(none)* |
| `intake.application.submitted` | [Intake/Application](intake.md) | [Eligibility/Determination](eligibility.md) |
| `intake.application.withdrawn` | [Intake/Application](intake.md) | *(none)* |
| `intake.review_reminder` | *(unknown)* | [Intake/Application](intake.md) |

## Subscribed but not emitted

These events are subscribed to but have no emitter in the current state machines:

- `intake.review_reminder` — subscribed by [Intake/Application](intake.md)
