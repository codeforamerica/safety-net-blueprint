---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** guard conditions, `if:` and `match:` steps, composition filters and `x-derived` fields are now evaluated as CEL by a spec-compliant implementation, where a regex translation to JavaScript ran them before. Write names without `$` (`object.status`, `reviewTask != null`), list membership as `x in list`, and test a field that may be absent with `has()`. (#445)
