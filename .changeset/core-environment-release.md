---
"@codeforamerica/blueprint-core": minor
---

Before, an environment could only change values, through `${VAR}`s, and resolve applied them in the middle of its steps. Now `resolve` takes `envOverlays` for what differs in shape between environments, such as how callers sign in, and applies the environment last, so `applyEnvironment` (also in `/browser`) can apply one later to contracts built without it, as the explorer does. `${VAR}`s in keys are filled in too. (#473)
