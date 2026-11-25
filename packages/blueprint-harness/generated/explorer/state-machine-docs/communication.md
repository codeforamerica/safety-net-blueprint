# Communication State Machine

Domain: `communication` | API: [communication-transcription-sessions-openapi.yaml](../../../contracts/base/domains/communication/communication-transcription-sessions-openapi.yaml), [communication-transcripts-openapi.yaml](../../../contracts/base/domains/communication/communication-transcripts-openapi.yaml) | State machine: [communication-transcription-sessions-state-machine.yaml](../../../contracts/communication-transcription-sessions-state-machine.yaml)

---

## TranscriptionSession

### Actions

- **start** — Start streaming. A new transcript is started, unless the session names one to carry on.
  - Transition: `created` → `connecting`
  - sets `startedById`
  - If `has(object.transcriptId)`:
    - `getTranscript`
    - `getTranscriptionProfile`
    - `startStream`
  - Else:
    - `createTranscript`
    - sets `transcriptId`
    - `getTranscriptionProfile`
    - `startStream`
  - Emit: `communication.transcription_session.connecting`
- **pause** — Take the conversation off the record. The transcript keeps the pause; the adapter closes the connection.
  - Transition: `connected` → `paused`
  - `pauseStream`
  - `pauseTranscript`
  - Emit: `communication.transcription_session.paused`
- **resume** — Put the conversation back on the record, and start the adapter streaming again. From created, a new session carries on a paused transcript.
  - Transition: `created`/`paused` → `connecting`
  - sets `startedById`
  - `resumeTranscript`
  - `getTranscript`
  - `getTranscriptionProfile`
  - `startStream`
  - Emit: `communication.transcription_session.connecting`
- **stop** — Finish. The adapter sends the end of the audio and publishes the last text, then ended, which closes the transcript.
  - Transition: `connecting`/`connected`/`paused`/`disconnected` → `stopping`
  - `stopStream`
  - Emit: `communication.transcription_session.stopping`

### Event subscriptions

- **`communication.transcription_session.connected`**
- **`communication.transcription_session.disconnected`**
- **`communication.transcription_session.failed`**
- **`communication.transcription_session.ended`**
  - `closeTranscript`
  - Emits `communication.transcription_session.closed`
- **`communication.transcript.paused`**
  - `pauseStream`
  - Emits `communication.transcription_session.paused`
- **`communication.transcript.closed`**
  - `stopStream`
  - Emits `communication.transcription_session.closed`

---

## Transcript

### Actions

- **pause** — Take the conversation off the record, at the time the client says.
  - Transition: `recording` → `paused`
  - `POST communication/transcripts/$object.id/entries`
  - Emit: `communication.transcript.paused`
    - Subscribed by: [Communication/TranscriptionSession](communication.md#transcriptionsession)
- **resume** — Put the conversation back on the record, at the time the client says. Already recording, nothing changes.
  - Transition: `paused`/`recording` → `recording`
  - If `openPause is not null`:
    - `PATCH communication/transcripts/$object.id/entries/$openPause.id`
    - Ask the scheduler for an idle check after the profile's idleTimeout, if it sets one.
    - Emit: `communication.transcript.resumed`
- **close** — End the transcript, at the time the client says. A pause still open ends then too.
  - Transition: `recording`/`paused` → `closed`
  - sets `closedAt`
  - If `openPause is not null`:
    - `PATCH communication/transcripts/$object.id/entries/$openPause.id`
  - Cancel the idle check of a transcript that was closed. One that already fired is closing it, and the cancel does nothing.
  - Emit: `communication.transcript.closed`
    - Subscribed by: [Communication/TranscriptionSession](communication.md#transcriptionsession)

### Event subscriptions

- **`communication.transcript.created`**
  - Ask the scheduler for an idle check after the profile's idleTimeout, if it sets one.
- **`communication.transcript_entry.created`**
  - If `this.data.kind is not "pause"`:
    - `PATCH communication/transcripts/$this.data.transcriptId`
- **`communication.transcription_session.line_finished`**
  - Look up: session
  - `addTranscriptEntry`
- **`communication.transcription_session.connected`**
  - Look up: session
  - If `has(this.data.gap)`:
    - `addTranscriptEntry`
- **`communication.transcript.idle_check`**
  - Look up: newActivity
  - If `newActivity is not null`:
    - Ask the scheduler for an idle check after the profile's idleTimeout, if it sets one.
  - Else:
    - If `has(object.lastActivityAt)`:
      - `POST communication/transcripts/$object.id/close`
    - Else:
      - `POST communication/transcripts/$object.id/close`
