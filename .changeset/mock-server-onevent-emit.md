---
"@codeforamerica/blueprint-mock-server": patch
---

Before, a state machine subscription whose steps emit an event never produced it — the emit threw internally, the error was caught and logged, and the transition that triggered the subscription still succeeded, so the event was simply missing. Now it reaches the event log. (#448)
