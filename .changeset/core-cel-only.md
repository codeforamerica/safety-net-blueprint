---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** a metric's `filter`, an SLA type's conditions (`autoAssignWhen`, `pauseWhen` and the rest) and the `where:` of a context binding or `forEach` step take CEL, and validation refuses JSON Logic in them with the CEL to write instead. Rewrite each as a CEL string that reads the record as `item` in a filter or `where:` and as `object` in an SLA condition: `{ "==": [{ var: "status" }, "pending"] }` becomes `item.status == "pending"` or `object.status == "pending"`, and a missing field, which JSON Logic read as null, is tested with `has()`, as in `!has(item.assignedToId)`. Field-value pairs in a `where:` are unchanged. (#413)
