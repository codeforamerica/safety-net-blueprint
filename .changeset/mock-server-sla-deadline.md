---
"@codeforamerica/blueprint-mock-server": minor
---

The mock now sets `slaDeadline` on a record whose schema declares it, when its SLA clocks start, and keeps it current as they pause and resume, where before it was never set. (#516)
