---
"@codeforamerica/blueprint-core": minor
---

A state machine step's value can now be a time from now — `$now+1d`, `$now-30m`: `+` or `-`, a whole number, and `d`, `h`, `m` or `w` — to store a deadline on the record, which a timer's `fireAt` can then read. (#469)
