---
"@codeforamerica/blueprint-core": minor
---

Before, an `on:` reaction with `transition:` could only change the record its event was about. Now, for an event about another resource, it changes each of the machine's records that name the event's subject through the one field declaring `x-relationship` to that resource, and validation reports a machine with no such field, or more than one. (#520)
