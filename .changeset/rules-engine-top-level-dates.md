---
"@codeforamerica/blueprint-rules-engine": patch
---

Before, a date declared as an input of its own, such as `asOf`, reached expressions as a map, so `asOf.getFullYear()` failed. And a fact returning records that held dates failed with "cannot use getEvalContext outside of an evaluation". Now a top-level date is a timestamp, like a date inside an object, and records holding dates come back as values. (#481)
