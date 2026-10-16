---
"@codeforamerica/blueprint-cli": patch
---

Before, an overlay file carrying only a `config:` block, with no `actions:`, was skipped, so its settings had no effect. Now resolve reads it. (#470)
