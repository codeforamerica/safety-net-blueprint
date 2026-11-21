---
"@codeforamerica/blueprint-mock-server": patch
---

Before, a state machine was matched to its collection by adding "s" to its object's name, so a `Delivery` served at `/deliveries` started with no state and every action on it answered 409. Now a machine governs the resource core attaches it to, however its collection is spelled. (#492)
