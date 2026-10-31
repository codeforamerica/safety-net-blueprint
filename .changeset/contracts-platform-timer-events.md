---
"@codeforamerica/blueprint-safety-net-contracts": minor
---

**Breaking:** Where a scheduler listened for `scheduling.timer.requested` and `scheduling.timer.cancelled`, listen for `platform.timer.requested` and `platform.timer.cancelled`, which the shared `requestTimer` and `cancelTimer` procedures now emit. (#469)
