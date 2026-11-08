---
"@codeforamerica/blueprint-core": minor
---

Before, the `transcripts` capability recorded what transcription software heard but said nothing about how the software reached a transcription service. Now a transcript's `connect` action answers with where to stream and a short-lived credential, in one shape for every service, through a transcripts adapter a state implements (`communication-transcripts-adapter-openapi.yaml`); a relay a state runs in front of a service a browser can't reach speaks `communication-transcripts-audio-asyncapi.yaml`; and the transcription services registry lists the services the design was checked against. (#520)
