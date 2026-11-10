---
"@codeforamerica/blueprint-core": minor
---

Before, a generated `<name>-events-asyncapi.yaml` listed the events its API sends as channels and messages only. Now it also has a `send` operation for each of those events and a `receive` operation, such as `receiveIntakeApplicationSubmitted`, for each event its state machines react to. (#520)
