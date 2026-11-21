---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** Validation now reports an event not named `{domain}.{resource}.{event}`, the last two in snake_case, and a timer's callback is named that way too: where a state machine reacted to `communication.idle_check`, it reacts to `communication.transcript.idle_check`, and `decision-support.suggestion_expiry` is `decision-support.suggestion.suggestion_expiry`.
