---
"@codeforamerica/blueprint-safety-net-contracts": patch
---

Before, an expedited SNAP determination left the application's review task unflagged, because the reaction also wrote a `slaType` field Task doesn't have. Now the task gets `isExpedited: true`; its SLA stays as created.
