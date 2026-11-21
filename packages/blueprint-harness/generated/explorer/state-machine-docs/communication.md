# Communication State Machine

Domain: `communication` | API: [communication-transcription-sessions-openapi.yaml](../../../contracts/base/domains/communication/communication-transcription-sessions-openapi.yaml), [communication-transcripts-openapi.yaml](../../../contracts/base/domains/communication/communication-transcripts-openapi.yaml) | State machine: [communication-transcription-sessions-state-machine.yaml](../../../contracts/communication-transcription-sessions-state-machine.yaml)

---

## TranscriptionSession

### Actions

- **get-connection** — Get where to connect and a short-lived credential, starting the transcript the first time.
  - Transition: `created`/`disconnected`/`connecting` → `connecting`
  - If `!has(object.transcriptId)`:
    - `createTranscript`
    - sets `transcriptId`
  - `getConnectionTranscript`
  - Emit: `communication.transcription_session.connecting`
- **renew-connection** — Get a fresh credential while connected, with no change to the session.
  - Transition: no state change
  - `getConnectionTranscript`
- **connect** — The connection to the service is open. A stretch with nothing captured, after a reconnect or before carrying on a transcript, is recorded as a gap.
  - Transition: `connecting` → `connected`
  - If `has(request.gap)`:
    - `addTranscriptEntry`
  - Emit: `communication.transcription_session.connected`
- **disconnect** — The connection to the service dropped; the software will try again.
  - Transition: `connected` → `disconnected`
  - Emit: `communication.transcription_session.disconnected`
- **update-line** — A line in progress, to show. Nothing is kept; it's tied to its finished line by its key.
  - Transition: no state change
  - Emit: `communication.transcription_session.line_updated`
- **add-line** — A finished line, added to the transcript with its key, so a retry adds it once. Allowed while paused, for the last text before the pause; the transcript keeps it if it started before.
  - Transition: no state change
  - `addTranscriptEntry`
  - Emit: `communication.transcription_session.line_added`
- **pause** — Take the conversation off the record. The transcript keeps the pause; the software closes the connection.
  - Transition: `connected` → `paused`
  - `pauseTranscript`
  - Emit: `communication.transcription_session.paused`
- **resume** — Put the conversation back on the record. The software then asks how to stream again. From created, a new session carries on a paused transcript.
  - Transition: `created`/`paused` → `connecting`
  - `resumeTranscript`
  - Emit: `communication.transcription_session.connecting`
- **stop** — Finish. The software sends the end of the audio and waits for the last text, or closes at once when no connection is open.
  - Transition: `connected`/`paused`/`disconnected` → `stopping`
  - Emit: `communication.transcription_session.stopping`
- **close** — The last text is in and the connection is closed; the transcript closes.
  - Transition: `stopping` → `closed`
  - `closeTranscript`
  - Emit: `communication.transcription_session.closed`
- **fail** — The software gave up connecting or reconnecting. The transcript stays open.
  - Transition: `connecting`/`disconnected` → `failed`
  - Emit: `communication.transcription_session.failed`

### Event subscriptions

- **`communication.transcript.paused`**
  - Emits `communication.transcription_session.paused`
- **`communication.transcript.closed`**
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
- **get-connection** — Get what the software needs to stream the conversation's audio to its transcription service — where to connect, and a short-lived credential.
  - Transition: no state change
  - `issueTranscriptConnection`
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
- **`communication.transcript.idle_check`**
  - Look up: newActivity
  - If `newActivity is not null`:
    - Ask the scheduler for an idle check after the profile's idleTimeout, if it sets one.
  - Else:
    - If `has(object.lastActivityAt)`:
      - `POST communication/transcripts/$object.id/close`
    - Else:
      - `POST communication/transcripts/$object.id/close`
