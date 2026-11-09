---
"@codeforamerica/blueprint-core": minor
---

Before, the generated `<name>-events-asyncapi.yaml` documented only the events an API sends. Now it also documents every event its state machines react to as a `receive` operation, such as `receiveIntakeApplicationSubmitted`, with each event's schema labeled as the OpenAPI 3.1 it's written in, so AsyncAPI's own tools read it. (#520)
