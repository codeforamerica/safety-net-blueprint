# Communication State Machine

Domain: `communication` | API: [communication-transcripts-openapi.yaml](../../../contracts/base/domains/communication/communication-transcripts-openapi.yaml) | State machine: [communication-transcripts-state-machine.yaml](../../../contracts/communication-transcripts-state-machine.yaml)

---

## Transcript

### Actions

- **pause** — Take the conversation off the record, at the time the client says.
  - Transition: `recording` → `paused`
  - `POST communication/transcripts/$object.id/entries`
  - Emit: `communication.transcript.paused`
- **resume** — Put the conversation back on the record, at the time the client says.
  - Transition: `paused` → `recording`
  - `PATCH communication/transcripts/$object.id/entries/$openPause.id`
  - Ask the scheduler for an idle check after the profile's idleTimeout, if it sets one.
  - Emit: `communication.transcript.resumed`
- **close** — End the transcript, at the time the client says. A pause still open ends then too.
  - Transition: `recording`/`paused` → `closed`
  - sets `closedAt`
  - If `openPause is not null`:
    - `PATCH communication/transcripts/$object.id/entries/$openPause.id`
  - Emit: `communication.transcript.closed`

### Event subscriptions

- **`communication.transcript.created`**
  - Ask the scheduler for an idle check after the profile's idleTimeout, if it sets one.
- **`communication.transcript_entry.created`**
  - If `this.data.kind is not "pause"`:
    - `PATCH communication/transcripts/$this.data.transcriptId`
- **`communication.idle_check`**
  - Look up: newActivity
  - If `newActivity is not null`:
    - Ask the scheduler for an idle check after the profile's idleTimeout, if it sets one.
  - Else:
    - If `has(object.lastActivityAt)`:
      - `POST communication/transcripts/$object.id/close`
    - Else:
      - `POST communication/transcripts/$object.id/close`
