# Published Events

Auto-generated from state machine `emit` and subscription declarations.

| Event | Published by | Subscribers |
|---|---|---|
| `ca.eligibility.determination.complete` | [Eligibility/Determination](eligibility.md) | *(none)* |
| `ca.intake.application.closed` | [Intake/Application](intake.md) | *(none)* |
| `ca.intake.application.submitted` | [Intake/Application](intake.md) | [Eligibility/Determination](eligibility.md) |
| `ca.intake.application.withdrawn` | [Intake/Application](intake.md) | *(none)* |
| `ca.intake.review_reminder` | *(unknown)* | [Intake/Application](intake.md) |

## Subscribed but not emitted

These events are subscribed to but have no emitter in the current state machines:

- `ca.intake.review_reminder` — subscribed by [Intake/Application](intake.md)
