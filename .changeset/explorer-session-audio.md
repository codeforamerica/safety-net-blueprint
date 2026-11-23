---
"@codeforamerica/blueprint-explorer": minor
---

Before, a transcription session could only be tried one call at a time, with lines typed in by hand. Now its start and resume take audio — a recording, the microphone, or typed lines spoken in the page — and the adapter for the session's profile's service streams it and publishes the session's events: the explorer's own, for `whisper`, transcribes in the page, and a site adds others on `BlueprintExplorer.sessionAdapters`. (#544)
