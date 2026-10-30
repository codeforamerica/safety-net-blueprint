---
"@codeforamerica/blueprint-mock-server": patch
---

Before, the mock started with `blueprint-mock` skipped a state machine step's call to a record — pausing a transcript wrote no pause entry — while the same contracts in a page did it. Now both make the call. (#469)
