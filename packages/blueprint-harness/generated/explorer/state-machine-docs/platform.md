# Platform State Machine

Domain: `platform` | API: [platform-transcripts-openapi.yaml](../../../contracts/base/domains/platform/platform-transcripts-openapi.yaml) | State machine: [platform-transcripts-state-machine.yaml](../../../contracts/platform-transcripts-state-machine.yaml)

---

## Transcript

### Actions

- **pause** — Take the conversation off the record.
  - Transition: `recording` → `paused`
  - Emit: `platform.transcript.paused`
- **resume** — Put the conversation back on the record.
  - Transition: `paused` → `recording`
  - Emit: `platform.transcript.resumed`
- **close** — End the transcript.
  - Transition: `recording`/`paused` → `closed`
  - sets `closedAt`
  - Emit: `platform.transcript.closed`
