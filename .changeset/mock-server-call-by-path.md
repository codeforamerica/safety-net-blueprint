---
"@codeforamerica/blueprint-mock-server": patch
---

Before, a state machine's call by path to another record's action ran with the caller's roles, and when that action refused, the calling action still answered 200 with its change saved, and a procedure's calls by path were dropped without a word. Now each call runs as the system, skipping only role matching, and a call that fails fails the action or reaction that made it, which saves nothing and answers or logs the call's error. (#534)
