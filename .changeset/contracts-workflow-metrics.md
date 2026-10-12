---
"@codeforamerica/blueprint-safety-net-contracts": patch
---

Before, the workflow metrics other than `tasks_in_queue` could never count anything: they named event types no event has, paired by a `resourceId` events do not carry, and matched SLA status with a path wildcard JSON Logic does not support. Now they name the `workflow.task.*` event types, pair by `subject`, and match SLA status with `some`. (#470)
