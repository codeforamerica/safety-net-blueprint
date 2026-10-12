---
"@codeforamerica/blueprint-core": minor
"@codeforamerica/blueprint-cli": minor
---

A contract set can now include the framework's `transcription` capability by listing it in `x-capabilities` in its config overlay: `/transcription/transcripts` starts, pauses, resumes and closes transcripts by the client's clock, each under a profile from `/transcription/profiles` that names its transcription service from a `transcription-services` registry, through the new `x-enum-source: { registry: <type> }` form. Its timeline is `/transcripts/{id}/entries` — lines, gaps and pauses — and an entry is accepted only if it started while the transcript was recording. (#470)
