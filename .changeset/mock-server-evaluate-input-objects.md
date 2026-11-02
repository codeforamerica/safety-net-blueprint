---
"@codeforamerica/blueprint-mock-server": minor
---

A state machine's `evaluate:` step can now build an input from several values — `current: {incomes: $inputs.incomes}` — whose fields are resolved as a call's body is. Before, an input had to be a single value expression. (#469)
