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
  - Emit: `transcription.transcript.resumed`
- **close** — End the transcript, at the time the client says. A pause still open ends then too.
  - Transition: `recording`/`paused` → `closed`
  - sets `closedAt`
  - If `openPause is not null`:
    - `PATCH transcription/transcripts/$object.id/entries/$openPause.id`
  - Emit: `transcription.transcript.closed`
