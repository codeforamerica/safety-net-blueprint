---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** metric filters, SLA conditions and `where:` conditions are evaluated as CEL, so one still written in JSON Logic matches nothing; rewrite it in CEL as `blueprint-validate` shows. A `forEach` step's `where:` now takes a CEL string, as a context binding's does. (#413)
