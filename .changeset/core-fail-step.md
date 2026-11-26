---
"@codeforamerica/blueprint-core": minor
---

A state machine step can now be `fail: {status, code, message}`, which stops an action or a reaction with that error, so a contract can refuse something a guard can't see up front, such as an event whose data disagrees with the record it's about.
