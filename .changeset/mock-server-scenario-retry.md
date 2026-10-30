---
"@codeforamerica/blueprint-mock-server": minor
---

A scenario step can now retry with Arazzo's `onFailure: [{ type: retry, retryAfter, retryLimit }]`, so a step checking what the mock does after it answers — a state machine's reaction to an event — passes once the reaction has run. `runScenario` refuses other failure actions by name. (#469)
