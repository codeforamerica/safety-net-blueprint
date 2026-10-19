---
"@codeforamerica/blueprint-core": minor
---

`inputOf(graph, factPath)` from `@codeforamerica/blueprint-core/cel` returns the input a list fact's items come from, such as `$.months[]` for `months.filter(...)`, or null when the expression builds new items. (#496)
