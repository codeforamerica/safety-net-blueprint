# Published Events

Auto-generated from state machine `emit` and subscription declarations.

| Event | Published by | Subscribers |
|---|---|---|
| `communication.transcript.closed` | [Communication/Transcript](communication.md#transcript) | [Communication/TranscriptionSession](communication.md#transcriptionsession) |
| `communication.transcript.created` | *(unknown)* | [Communication/Transcript](communication.md#transcript) |
| `communication.transcript.idle_check` | *(unknown)* | [Communication/Transcript](communication.md#transcript) |
| `communication.transcript.paused` | [Communication/Transcript](communication.md#transcript) | [Communication/TranscriptionSession](communication.md#transcriptionsession) |
| `communication.transcript.resumed` | [Communication/Transcript](communication.md#transcript) | *(none)* |
| `communication.transcript_entry.created` | *(unknown)* | [Communication/Transcript](communication.md#transcript) |
| `communication.transcription_session.connected` | *(unknown)* | [Communication/TranscriptionSession](communication.md#transcriptionsession), [Communication/Transcript](communication.md#transcript) |
| `communication.transcription_session.connecting` | [Communication/TranscriptionSession](communication.md#transcriptionsession) | *(none)* |
| `communication.transcription_session.disconnected` | *(unknown)* | [Communication/TranscriptionSession](communication.md#transcriptionsession) |
| `communication.transcription_session.ended` | *(unknown)* | [Communication/TranscriptionSession](communication.md#transcriptionsession) |
| `communication.transcription_session.failed` | *(unknown)* | [Communication/TranscriptionSession](communication.md#transcriptionsession) |
| `communication.transcription_session.line_finished` | *(unknown)* | [Communication/Transcript](communication.md#transcript) |
| `communication.transcription_session.paused` | [Communication/TranscriptionSession](communication.md#transcriptionsession) | *(none)* |
| `communication.transcription_session.stopping` | [Communication/TranscriptionSession](communication.md#transcriptionsession) | *(none)* |
| `decision-support.suggestion.accepted` | [Decision Support/Suggestion](decision-support.md) | *(none)* |
| `decision-support.suggestion.created` | *(unknown)* | [Decision Support/Suggestion](decision-support.md) |
| `decision-support.suggestion.dismissed` | [Decision Support/Suggestion](decision-support.md) | *(none)* |
| `decision-support.suggestion.expired` | [Decision Support/Suggestion](decision-support.md) | *(none)* |
| `decision-support.suggestion.refused` | [Decision Support/Suggestion](decision-support.md) | *(none)* |
| `decision-support.suggestion.suggestion_expiry` | *(unknown)* | [Decision Support/Suggestion](decision-support.md) |
| `eligibility.determination.complete` | [Eligibility/Determination](eligibility.md) | *(none)* |
| `intake.application.closed` | [Intake/Application](intake.md#application) | *(none)* |
| `intake.application.review_reminder` | *(unknown)* | [Intake/Application](intake.md#application) |
| `intake.application.submitted` | [Intake/Application](intake.md#application) | [Eligibility/Determination](eligibility.md) |
| `intake.application.withdrawn` | [Intake/Application](intake.md#application) | *(none)* |
| `intake.application_income.created` | *(unknown)* | [Intake/Interview](intake.md#interview) |
| `intake.application_income.updated` | *(unknown)* | [Intake/Interview](intake.md#interview) |
| `intake.interview.completed` | [Intake/Interview](intake.md#interview) | *(none)* |
| `intake.interview.started` | [Intake/Interview](intake.md#interview) | *(none)* |

## Subscribed but not emitted

These events are subscribed to but have no emitter in the current state machines:

- `communication.transcript.created` — subscribed by [Communication/Transcript](communication.md#transcript)
- `communication.transcript.idle_check` — subscribed by [Communication/Transcript](communication.md#transcript)
- `communication.transcript_entry.created` — subscribed by [Communication/Transcript](communication.md#transcript)
- `communication.transcription_session.connected` — subscribed by [Communication/TranscriptionSession](communication.md#transcriptionsession), [Communication/Transcript](communication.md#transcript)
- `communication.transcription_session.disconnected` — subscribed by [Communication/TranscriptionSession](communication.md#transcriptionsession)
- `communication.transcription_session.ended` — subscribed by [Communication/TranscriptionSession](communication.md#transcriptionsession)
- `communication.transcription_session.failed` — subscribed by [Communication/TranscriptionSession](communication.md#transcriptionsession)
- `communication.transcription_session.line_finished` — subscribed by [Communication/Transcript](communication.md#transcript)
- `decision-support.suggestion.created` — subscribed by [Decision Support/Suggestion](decision-support.md)
- `decision-support.suggestion.suggestion_expiry` — subscribed by [Decision Support/Suggestion](decision-support.md)
- `intake.application.review_reminder` — subscribed by [Intake/Application](intake.md#application)
- `intake.application_income.created` — subscribed by [Intake/Interview](intake.md#interview)
- `intake.application_income.updated` — subscribed by [Intake/Interview](intake.md#interview)
