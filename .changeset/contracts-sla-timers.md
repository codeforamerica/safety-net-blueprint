---
"@codeforamerica/blueprint-safety-net-contracts": minor
---

A workflow task's SLA warning and breach timers are now scheduled when it's created with an SLA type, cancelled when it pauses, and scheduled again at the moved deadline when it resumes. Before, they were scheduled only when a client set `slaDeadline`, which the server sets. (#516)
