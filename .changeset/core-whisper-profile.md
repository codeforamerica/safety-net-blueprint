---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** The framework's example transcription profile, `english`, which named Amazon Transcribe, is now `whisper`, naming Whisper, with the same id. Every contract set now starts with a profile that runs in a page with no service or account; a state overlays it with its own service, as before.
