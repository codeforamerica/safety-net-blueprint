---
"@codeforamerica/blueprint-mock-server": patch
---

Before, a context binding with no `where:` was skipped with a warning and bound null. Now it binds the first record in its collection, as the state machine schema says, and a `forEach` with no `where:` runs once for every record. (#534)
