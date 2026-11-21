---
"@codeforamerica/blueprint-safety-net-contracts": minor
---

**Breaking:** Workflow's timer callbacks are named for the task, as `workflow.task.creation_deadline`, `workflow.task.sla_warning`, `workflow.task.sla_breach`, `workflow.task.client_timeout` and `workflow.task.verification_timeout`, and `workflow.task.de-escalated` is `workflow.task.de_escalated`.
