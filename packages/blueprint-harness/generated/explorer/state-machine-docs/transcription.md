# Transcription State Machine

Domain: `transcription` | API: [transcription-transcripts-openapi.yaml](../../../contracts/base/domains/transcription/transcription-transcripts-openapi.yaml) | State machine: [transcription-transcripts-state-machine.yaml](../../../contracts/transcription-transcripts-state-machine.yaml)

---

## Transcript

### Actions

- **pause** — Take the conversation off the record.
  - Transition: `recording` → `paused`
  - Emit: `transcription.transcript.paused`
- **resume** — Put the conversation back on the record.
  - Transition: `paused` → `recording`
  - Emit: `transcription.transcript.resumed`
- **close** — End the transcript.
  - Transition: `recording`/`paused` → `closed`
  - sets `closedAt`
  - Emit: `transcription.transcript.closed`
