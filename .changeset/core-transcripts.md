---
"@codeforamerica/blueprint-core": minor
"@codeforamerica/blueprint-cli": minor
---

A contract set can now include the framework's `transcription` capability by listing it in `x-capabilities` in its config overlay: `/transcription/transcripts` starts, pauses, resumes and closes transcripts, each by the client's clock, and records what produced each one — the client, the transcription service as its `provider` (an entry of a `transcription-services` registry, through the new `x-enum-source: { registry: <type> }` form) and the service's `model`. Its timeline is `/transcripts/{id}/entries` — lines, gaps and pauses — and an entry is accepted only if it started while the transcript was recording. (#470)
