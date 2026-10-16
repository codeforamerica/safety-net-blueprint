---
"@codeforamerica/blueprint-core": patch
---

Before, a ruleset reading a list given as an input of its own, such as `programsAppliedFor`, compiled to a graph that failed validation. Now its dependencies validate. (#481)
