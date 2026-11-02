---
"@codeforamerica/blueprint-core": minor
---

A state machine action, procedure or reaction to an event can now call an operation — `call: { operationId, parameters, requestBody: { payload } }` — through the API, as the system by default or with `runAs: caller` as whoever triggered it, with `catch: { as, do, to }` for when it fails and `bind:` to keep what it answered. Validation refuses an `operationId` the set has no operation for, naming the capability to list when the operation belongs to one. (#469)
