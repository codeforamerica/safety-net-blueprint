---
"@codeforamerica/blueprint-core": minor
---

A state machine step's value can now be a time from now — `$now`, then `+` or `-` and an ISO 8601 duration, as in `$now+P1D` — to store a deadline on the record, which a timer's `fireAt` can then read. (#469)
