---
"@codeforamerica/blueprint-mock-server": patch
---

Before, an action's request schema with a `$ref` into another file, and the response schema a routed handler's answer is checked against, were skipped with a warning that no validator could be compiled. Now both are checked, so a request or an answer they don't allow is refused. (#520)
