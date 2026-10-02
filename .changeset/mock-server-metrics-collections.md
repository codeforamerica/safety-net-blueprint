---
"@codeforamerica/blueprint-mock-server": patch
---

Before, a contract set with a metric counting anything other than `tasks` or `events` got a 500 from the metrics endpoint. Now the collections come from the metric definitions, so counting applications or determinations works. (#448)
