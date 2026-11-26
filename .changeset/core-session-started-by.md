---
"@codeforamerica/blueprint-core": minor
---

Before, any caller could publish a transcription session's adapter events, such as `connected` or `line_finished`, for any session. Now a session records `startedById` when it starts or resumes, and the session and the transcript ignore an adapter event whose `authid` isn't that caller. (#548)
