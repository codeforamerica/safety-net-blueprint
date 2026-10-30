---
"@codeforamerica/blueprint-core": minor
---

Before, a decision made for each item of a list and then about the whole, such as whether each review month counts and then whether enough did, couldn't be written in one ruleset. Now a list fact names its items with `as`, a fact at `reviewMonths[].qualifies` is computed once for each item, a compiled graph declares its `formatVersion` (`1.1` with per-item facts, `1.0` without), and `inputOf(graph, factPath)` from `@codeforamerica/blueprint-core/cel` says which input a list fact's items come from. (#496)
