---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** Where a write named a record that isn't there through a polymorphic reference, it now gets 422, checked against the resource its type field names. (#516)
