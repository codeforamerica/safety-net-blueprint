---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** A transcription session's actions are now only what an app does — `start`, `pause`, `resume` and `stop` — and its adapter (`communication-transcription-sessions-adapter-openapi.yaml`, in place of the transcript audio adapter) streams when the session calls `startStream`, `pauseStream` or `stopStream`, gets its own credential from `requestCredentials`, and reports by publishing the session's events, which the session and the transcript follow. Where a client called `get-connection`, `renew-connection`, `connect`, `update-line`, `add-line`, `disconnect`, `close` or `fail`, the adapter now publishes `connected`, `line_updated`, `line_finished` (in place of `line_added`), `disconnected`, `failed` or `ended`, and a transcript's `get-connection` is removed. (#548)
