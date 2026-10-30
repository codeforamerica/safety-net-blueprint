---
"@codeforamerica/blueprint-core": minor
---

A state machine action can now call an operation by its `operationId` — `call: { operationId, parameters, body }`, or a call held in data such as `call: $request.call` — with `runAs: caller` to make it as whoever triggered the action, under the operation's own permissions and checks, and `onFailure: { to, then }` for what happens when it fails. (#469)
