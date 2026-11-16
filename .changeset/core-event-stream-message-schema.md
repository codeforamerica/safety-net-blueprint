---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** `validate` now reports a `text/event-stream` response whose schema is a bare `type: string` (`event-stream-message-schema`). Describe one event's data instead, usually a `$ref` to it, so readers and generated clients know what each message holds. (#520)
