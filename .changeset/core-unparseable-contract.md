---
"@codeforamerica/blueprint-core": patch
---

Before, `discover` left out a contract file that wasn't valid YAML, so `validate` passed and the set ran without it — a state machine with a typo simply wasn't there. Now `discover` and `load` throw, naming the file and the line and column where it fails. (#469)
