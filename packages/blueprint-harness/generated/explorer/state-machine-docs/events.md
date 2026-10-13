# Published Events

Auto-generated from state machine `emit` and subscription declarations.

| Event | Published by | Subscribers |
|---|---|---|
| `eligibility.determination.complete` | [Eligibility/Determination](eligibility.md) | *(none)* |
| `intake.application.closed` | [Intake/Application](intake.md) | *(none)* |
| `intake.application.submitted` | [Intake/Application](intake.md) | [Eligibility/Determination](eligibility.md) |
| `intake.application.withdrawn` | [Intake/Application](intake.md) | *(none)* |
| `intake.review_reminder` | *(unknown)* | [Intake/Application](intake.md) |
| `transcription.idle_check` | *(unknown)* | [Transcription/Transcript](transcription.md) |
| `transcription.transcript.closed` | [Transcription/Transcript](transcription.md) | *(none)* |
| `transcription.transcript.created` | *(unknown)* | [Transcription/Transcript](transcription.md) |
| `transcription.transcript.paused` | [Transcription/Transcript](transcription.md) | *(none)* |
| `transcription.transcript.resumed` | [Transcription/Transcript](transcription.md) | *(none)* |
| `transcription.transcript_entry.created` | *(unknown)* | [Transcription/Transcript](transcription.md) |

## Subscribed but not emitted

These events are subscribed to but have no emitter in the current state machines:

- `intake.review_reminder` — subscribed by [Intake/Application](intake.md)
- `transcription.idle_check` — subscribed by [Transcription/Transcript](transcription.md)
- `transcription.transcript.created` — subscribed by [Transcription/Transcript](transcription.md)
- `transcription.transcript_entry.created` — subscribed by [Transcription/Transcript](transcription.md)
