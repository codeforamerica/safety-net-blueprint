---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** Before, an overlay target with an index (`$.machines[0]`), a quoted name (`outputs['risks.earnedIncomeVaries']`) or other syntax overlays don't support matched nothing, and the action was skipped with a warning. Now indexes and quoted names work, and any other syntax, such as a wildcard (`[*]`), fails resolve with an error naming the target. (#502)
