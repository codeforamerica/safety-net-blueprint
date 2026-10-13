# Transcription State Machine

Domain: `transcription` | API: [transcription-transcripts-openapi.yaml](../../../contracts/base/domains/transcription/transcription-transcripts-openapi.yaml) | State machine: [transcription-transcripts-state-machine.yaml](../../../contracts/transcription-transcripts-state-machine.yaml)

---

## Transcript

### Actions

- **pause** — Take the conversation off the record, at the time the client says.
  - Transition: `recording` → `paused`
  - `POST transcription/transcripts/$object.id/entries`
  - Emit: `transcription.transcript.paused`
- **resume** — Put the conversation back on the record, at the time the client says.
  - Transition: `paused` → `recording`
  - `PATCH transcription/transcripts/$object.id/entries/$openPause.id`
  - Ask the scheduler for an idle check after the profile's idleTimeout, if it sets one.
  - Emit: `transcription.transcript.resumed`
- **close** — End the transcript, at the time the client says. A pause still open ends then too.
  - Transition: `recording`/`paused` → `closed`
  - sets `closedAt`
  - If `openPause is not null`:
    - `PATCH transcription/transcripts/$object.id/entries/$openPause.id`
  - Emit: `transcription.transcript.closed`

### Event subscriptions

- **`transcription.transcript.created`**
  - Ask the scheduler for an idle check after the profile's idleTimeout, if it sets one.
- **`transcription.transcript_entry.created`**
  - If `this.data.kind is not "pause"`:
    - `PATCH transcription/transcripts/$this.data.transcriptId`
- **`transcription.idle_check`**
  - Look up: newActivity
  - If `newActivity is not null`:
    - Ask the scheduler for an idle check after the profile's idleTimeout, if it sets one.
  - Else:
    - If `has(object.lastActivityAt)`:
      - `POST transcription/transcripts/$object.id/close`
    - Else:
      - `POST transcription/transcripts/$object.id/close`
