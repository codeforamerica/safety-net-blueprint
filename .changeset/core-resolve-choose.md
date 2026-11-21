---
"@codeforamerica/blueprint-core": minor
---

Before, `resolve(docs, options)` always returned the whole set. Now `domains` and `capabilities` options keep only the documents declaring them, with everything they `$ref` or extend, the parts of platform they use and the scenarios whose every source is kept, mapping a polymorphic type whose resource was left out to `External` so the part validates on its own. (#543)
