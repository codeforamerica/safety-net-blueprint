# Published Events

Auto-generated from state machine `emit` and subscription declarations.

| Event | Published by | Subscribers |
|---|---|---|
| `communication.idle_check` | *(unknown)* | [Communication/Transcript](communication.md) |
| `communication.transcript.closed` | [Communication/Transcript](communication.md) | *(none)* |
| `communication.transcript.created` | *(unknown)* | [Communication/Transcript](communication.md) |
| `communication.transcript.paused` | [Communication/Transcript](communication.md) | *(none)* |
| `communication.transcript.resumed` | [Communication/Transcript](communication.md) | *(none)* |
| `communication.transcript_entry.created` | *(unknown)* | [Communication/Transcript](communication.md) |
| `eligibility.determination.complete` | [Eligibility/Determination](eligibility.md) | *(none)* |
| `intake.application.closed` | [Intake/Application](intake.md) | *(none)* |
| `intake.application.submitted` | [Intake/Application](intake.md) | [Eligibility/Determination](eligibility.md) |
| `intake.application.withdrawn` | [Intake/Application](intake.md) | *(none)* |
| `intake.review_reminder` | *(unknown)* | [Intake/Application](intake.md) |

## Subscribed but not emitted

These events are subscribed to but have no emitter in the current state machines:

- `communication.idle_check` — subscribed by [Communication/Transcript](communication.md)
- `communication.transcript.created` — subscribed by [Communication/Transcript](communication.md)
- `communication.transcript_entry.created` — subscribed by [Communication/Transcript](communication.md)
- `intake.review_reminder` — subscribed by [Intake/Application](intake.md)
