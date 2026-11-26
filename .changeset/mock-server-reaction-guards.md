---
"@codeforamerica/blueprint-mock-server": minor
---

Before, the mock ignored the guards on a state machine's event reactions (`on:`), and a routed handler's `call` and `publish` were made with no caller. Now a reaction runs only when one of its guard clauses passes, as an action's does. A handler's `call` and `publish` send the `Authorization`, `X-Caller-Id` and `X-Caller-Roles` of the request it's handling, unless it passes its own. A scenario step that sends an event takes `header` parameters, such as `X-Caller-Id`, to publish as a caller. (#548)
