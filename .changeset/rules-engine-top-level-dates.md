---
"@codeforamerica/blueprint-rules-engine": patch
---

Before, a date declared as an input of its own, such as `asOf`, reached expressions as a map, so `asOf.getFullYear()` failed. Now it's a timestamp, like a date inside an object. (#481)
