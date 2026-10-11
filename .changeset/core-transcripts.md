---
"@codeforamerica/blueprint-core": minor
"@codeforamerica/blueprint-cli": minor
---

A contract set can now include the framework's `transcription` capability by listing it in `x-capabilities` in its config overlay: `/transcription/transcripts` starts, lists, updates and deletes transcripts, and `pause`, `resume` and `close` move one on and off the record and end it, each emitting its event. Starting one requires what produced it: the client, the transcription service as its `provider` (an entry of a `transcription-services` registry a set can extend, through the new `x-enum-source: { registry: <type> }` form) and the service's `model`. (#470)
