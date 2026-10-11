---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** before, an event with no `traceparent`, `causationid`, `authid`, `authtype` or `data` carried each as `null`. Now each is left out of the event. (#470)
