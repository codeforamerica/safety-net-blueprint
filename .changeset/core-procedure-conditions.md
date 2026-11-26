---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** before, a procedure's `conditions:` list passed validation. Now validation refuses it and says to write each condition as an `if:` step with a CEL condition. (#413)
