---
"@codeforamerica/blueprint-core": patch
---

Before, a state machine could refuse something only with a guard, before its steps ran, and a reaction's guard that failed skipped it quietly. Now a step can be `fail: {status, code, message}`, which stops an action or a reaction with that error, for something a guard can't see, such as an event whose data disagrees with the record it's about.
