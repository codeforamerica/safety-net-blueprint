---
"@codeforamerica/blueprint-core": minor
---

Before, a state machine's guards applied only to its own actions, so nothing could refuse a record added under the object it governs. Now a machine's `resources:` declares guards for creating and updating its own object and the resources nested under it, at any depth. (#470)
