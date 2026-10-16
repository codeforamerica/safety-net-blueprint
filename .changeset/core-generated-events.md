---
"@codeforamerica/blueprint-core": minor
"@codeforamerica/blueprint-cli": minor
---

**Breaking:** Resolve now writes `<name>-events-asyncapi.yaml` beside each OpenAPI document, documenting every event its resources and their state machines send, so `x-events` and a state machine's `eventsSpec` are ignored, with a warning, and a hand-written channel for a generated event is a validation error. (#470)
