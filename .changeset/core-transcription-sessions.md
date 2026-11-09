---
"@codeforamerica/blueprint-core": minor
---

Before, the `transcripts` capability defined the transcript but not how transcription software keeps track of its connection to a service. Now it includes a transcription session (`communication-transcription-sessions-openapi.yaml` and its state machine), designed to run in the page: the page and the software tell it what happens, its actions call the transcript's operations, each sends an event, and it pauses or closes when its transcript does. (#520)
