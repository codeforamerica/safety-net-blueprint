---
"@codeforamerica/blueprint-mock-server": minor
---

The mock now makes a state machine step's call to an operation through the API, as the system — whose events carry `authid: system`, and which no client can claim to be — or with `runAs: caller` as the caller. A failed call runs the step's `catch:`, and with none, nothing the action or reaction did is saved. (#469)
