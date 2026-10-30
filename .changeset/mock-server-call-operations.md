---
"@codeforamerica/blueprint-mock-server": minor
---

The mock now performs a call to an operation where it stands in an action's steps, a procedure's, or a reaction to an event. The call goes through the API, so a refusal is the same 409 or 422 a request would get. By default it's made as the system, which skips only role matching and whose events carry `authid: system`; with `runAs: caller` it's made as the caller — the system, in a reaction — whose roles can also bring a 403. Only the mock's own call is the system: a client sending `X-Caller-Roles: system` gets no bypass. The call's events name the action's first event, or the event reacted to, as their `causationid`. A failed call runs the step's `onFailure:` instead of the steps — in an action or a reaction, which then end in its `to`; in a procedure, which it ends. With none, nothing is saved: the action fails, and so does an action whose procedure's call failed. (#469)
