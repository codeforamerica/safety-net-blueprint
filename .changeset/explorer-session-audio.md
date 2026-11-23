---
"@codeforamerica/blueprint-explorer": minor
---

Before, a transcription session could only be tried one call at a time, with lines typed in by hand. Now its start and resume take audio — a recording, the microphone, or typed lines spoken in the page — which the session's adapter, routed in the site's `routing:`, streams; `sessionAdapter` (`@codeforamerica/blueprint-explorer/session-adapter`) does what every adapter shares, and `examples/session-adapters/whisper.js` transcribes in the page. (#544)
