---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** An overlay target using syntax overlays don't support, such as a wildcard (`[*]`) or a slice (`[0:2]`), now fails resolve with an error naming the target, where before it matched nothing and was skipped with a warning. Index selectors (`$.machines[0]`) and quoted names (`outputs['risks.earnedIncomeVaries']`), which also matched nothing, now work. (#502)
