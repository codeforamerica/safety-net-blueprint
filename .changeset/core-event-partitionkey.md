---
"@codeforamerica/blueprint-core": minor
---

An event can now carry the CloudEvents `partitionkey`: a subscriber handles events with the same key one at a time, in the order they occurred. (#469)
