# Published Events

Auto-generated from state machine `emit` and subscription declarations.

| Event | Published by | Subscribers |
|---|---|---|
| `communication.idle_check` | *(unknown)* | [Communication/Transcript](communication.md) |
| `communication.transcript.closed` | [Communication/Transcript](communication.md) | [Communication/TranscriptionSession](communication.md) |
| `communication.transcript.created` | *(unknown)* | [Communication/Transcript](communication.md) |
| `communication.transcript.paused` | [Communication/Transcript](communication.md) | [Communication/TranscriptionSession](communication.md) |
| `communication.transcript.resumed` | [Communication/Transcript](communication.md) | *(none)* |
| `communication.transcript_entry.created` | *(unknown)* | [Communication/Transcript](communication.md) |
| `communication.transcription_session.closed` | [Communication/TranscriptionSession](communication.md) | *(none)* |
| `communication.transcription_session.connected` | [Communication/TranscriptionSession](communication.md) | *(none)* |
| `communication.transcription_session.connecting` | [Communication/TranscriptionSession](communication.md) | *(none)* |
| `communication.transcription_session.disconnected` | [Communication/TranscriptionSession](communication.md) | *(none)* |
| `communication.transcription_session.failed` | [Communication/TranscriptionSession](communication.md) | *(none)* |
| `communication.transcription_session.line_added` | [Communication/TranscriptionSession](communication.md) | *(none)* |
| `communication.transcription_session.line_updated` | [Communication/TranscriptionSession](communication.md) | *(none)* |
| `communication.transcription_session.paused` | [Communication/TranscriptionSession](communication.md) | *(none)* |
| `communication.transcription_session.stopping` | [Communication/TranscriptionSession](communication.md) | *(none)* |
| `decision-support.suggestion.accepted` | [Decision Support/Suggestion](decision-support.md) | *(none)* |
| `decision-support.suggestion.created` | *(unknown)* | [Decision Support/Suggestion](decision-support.md) |
| `decision-support.suggestion.dismissed` | [Decision Support/Suggestion](decision-support.md) | *(none)* |
| `decision-support.suggestion.expired` | [Decision Support/Suggestion](decision-support.md) | *(none)* |
| `decision-support.suggestion.refused` | [Decision Support/Suggestion](decision-support.md) | *(none)* |
| `decision-support.suggestion_expiry` | *(unknown)* | [Decision Support/Suggestion](decision-support.md) |
| `eligibility.determination.complete` | [Eligibility/Determination](eligibility.md) | *(none)* |
| `intake.application.closed` | [Intake/Application](intake.md#application) | *(none)* |
| `intake.application.submitted` | [Intake/Application](intake.md#application) | [Eligibility/Determination](eligibility.md) |
| `intake.application.withdrawn` | [Intake/Application](intake.md#application) | *(none)* |
| `intake.application_income.created` | *(unknown)* | [Intake/Interview](intake.md#interview) |
| `intake.application_income.updated` | *(unknown)* | [Intake/Interview](intake.md#interview) |
| `intake.interview.completed` | [Intake/Interview](intake.md#interview) | *(none)* |
| `intake.interview.started` | [Intake/Interview](intake.md#interview) | *(none)* |
| `intake.review_reminder` | *(unknown)* | [Intake/Application](intake.md#application) |

## Subscribed but not emitted

These events are subscribed to but have no emitter in the current state machines:

- `communication.idle_check` — subscribed by [Communication/Transcript](communication.md)
- `communication.transcript.created` — subscribed by [Communication/Transcript](communication.md)
- `communication.transcript_entry.created` — subscribed by [Communication/Transcript](communication.md)
- `decision-support.suggestion.created` — subscribed by [Decision Support/Suggestion](decision-support.md)
- `decision-support.suggestion_expiry` — subscribed by [Decision Support/Suggestion](decision-support.md)
- `intake.application_income.created` — subscribed by [Intake/Interview](intake.md#interview)
- `intake.application_income.updated` — subscribed by [Intake/Interview](intake.md#interview)
- `intake.review_reminder` — subscribed by [Intake/Application](intake.md#application)
