---
"@codeforamerica/blueprint-core": minor
---

A state machine action, procedure or reaction to an event can now call an operation by its `operationId` — `call: { operationId, parameters, body }`, or a call held in data such as `call: $request.call` — made through the API either way, so the operation's validation, its checks and its guards' conditions apply — as the system by default, which skips only role matching and names the system as who acted, or with `runAs: caller` as whoever triggered it, under their roles — `onFailure: { to, then }` for what happens when it fails, and `bind:` to keep what it answered for the steps after it. Validation refuses `onFailure:` or `bind:` on a call by method and path, or on a call to a procedure, since only a call to an operation reports a failure or answers. (#469)
