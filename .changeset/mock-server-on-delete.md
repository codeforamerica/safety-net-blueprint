---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** Where deleting a record left others naming it, the delete is now refused with 409, unless their relationship declares `onDelete: cascade`, which deletes them with it. (#516)
