---
"@codeforamerica/blueprint-mock-server": minor
---

Before, a reader of `GET /platform/events/stream` that lost its connection missed whatever happened until it reconnected, and got every event. Now each event carries its `id`, a reader that reconnects with `Last-Event-ID` is sent what it missed first (or `410` when the log no longer has that id), and the stream takes the `type`, `source` and `subject` filters listing events does. (#520)
