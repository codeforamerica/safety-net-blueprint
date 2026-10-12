---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** A state machine's `events:` is now `on:`, and the events its resource sends are declared once under `emits:` and sent by name (`emit: claimed`), which resolve expands to `{domain}.{resource}.{event}` — the domain as declared, the resource's schema name in snake_case. (#470)
