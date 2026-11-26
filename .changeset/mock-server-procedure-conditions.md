---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** before, the mock ran a procedure's `conditions:` list of JSON Logic conditions. Now it runs only a procedure's steps, so write each condition as an `if:` step, and `json-logic-js` is no longer installed. (#413)
