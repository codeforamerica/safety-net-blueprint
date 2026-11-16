---
"@codeforamerica/blueprint-mock-server": patch
---

Before, a value expression reading a nested request field, such as `$request.gap.startedAt`, found nothing. Now it reads the nested field, as `$object` and `$this` paths do. (#520)
