---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** Where a client could change a field marked `readOnly`, such as a state machine's `status`, by updating the record, it now gets 422. A state machine acting as the system still may, while a client sending the `system` role in `X-Caller-Roles` may not, and a value the server sets anyway passes. (#516)
