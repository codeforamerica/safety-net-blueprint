---
"@codeforamerica/blueprint-core": minor
"@codeforamerica/blueprint-cli": patch
"@codeforamerica/blueprint-explorer": patch
---

**Breaking:** Before, a state machine subscribed under `events:` and emitted full event names. Now it subscribes under `on:`, declares its resource's events once under `emits:` and sends them by name (`emit: claimed`), which resolve expands to `{domain}.{resource}.{event}`. (#470)
