---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** Where a client could change a field marked `readOnly`, such as a state machine's `status`, by updating the record, it now gets 422. A caller with the `system` role still may, and a value the server sets anyway passes. (#516)
