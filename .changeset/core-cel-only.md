---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** a metric's `filter`, an SLA type's conditions (`autoAssignWhen`, `pauseWhen` and the rest) and the `where:` of a context binding or `forEach` step take CEL, and validation refuses JSON Logic in them with the CEL to write instead. Rewrite each as a CEL string: `{ "==": [{ var: "status" }, "pending"] }` becomes `status == "pending"` in a filter or condition, and `item.status == "pending"` in a `where:`; field-value pairs in a `where:` are unchanged. (#413)
