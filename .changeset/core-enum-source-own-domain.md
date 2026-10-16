---
"@codeforamerica/blueprint-core": patch
---

Before, `x-enum-source: states[].id` naming no machine took the states of whichever state machine resolve read last, so adding a state machine document could change another domain's enum. Now it takes the states of the annotated schema's own domain. (#470)
