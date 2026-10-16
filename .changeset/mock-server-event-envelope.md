---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** before, an event with no `traceparent`, `causationid`, `authid`, `authtype` or `data` carried each as `null`, and every event carried the store's `createdAt` and `updatedAt`. Now each absent attribute is left out, and an event's only timestamp is its `time`. (#470)
