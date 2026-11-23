---
"@codeforamerica/blueprint-core": minor
---

Before, a transcription session could only be read by its id. Now `listTranscriptionSessions` (`GET /transcription-sessions`) lists them, newest first, and `q` filters them by `status` or `transcriptId`. (#548)
