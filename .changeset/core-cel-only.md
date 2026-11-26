---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** a metric's `filter`, an SLA type's conditions (`autoAssignWhen`, `pauseWhen` and the rest) and the `where:` of a context binding or `forEach` step take CEL, and validation refuses JSON Logic in them with the CEL to write instead. Rewrite each as CEL that reads the record as `item` in a filter or `where:` and as `object` in an SLA condition, testing for a missing field with `has()`: `{ "==": [{ var: "assignedToId" }, null] }` becomes `!has(item.assignedToId) || item.assignedToId == null`. (#413)
