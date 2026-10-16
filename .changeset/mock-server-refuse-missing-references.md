---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** A create or update whose `x-relationship` id, at any depth in the body, names no record the mock holds, or a record under a different parent than the write, is now refused with a 422 naming the field. A nested create under a parent that isn't there now gets a 404. (#481)
