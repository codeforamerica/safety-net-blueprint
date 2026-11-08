---
"@codeforamerica/blueprint-core": minor
"@codeforamerica/blueprint-cli": minor
---

**Breaking:** Resolve now writes `<name>-events-asyncapi.yaml` beside each OpenAPI document, documenting every event its resources and their state machines send as a `send` operation and every event those machines react to as a `receive` operation, such as `receiveIntakeApplicationSubmitted`, each event's schema labeled as the OpenAPI 3.1 it's written in, so AsyncAPI's own tools read it. `x-events` and a state machine's `eventsSpec` are ignored, with a warning, and a hand-written channel for a generated event is a validation error. (#470, #520)
