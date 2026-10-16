---
"@codeforamerica/blueprint-mock-server": patch
---

Before, `/workflow/metrics` reported `0` for every count and ratio metric whatever the store held, and `groupBy` failed for a metric over any collection but tasks and events. Now it counts every matching record, windows events by their `time`, and pairs a duration's events by `subject` unless `pairBy` names another field. (#470)
