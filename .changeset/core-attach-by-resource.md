---
"@codeforamerica/blueprint-core": minor
"@codeforamerica/blueprint-mock-server": patch
"@codeforamerica/blueprint-explorer": patch
---

Before, a state machine's transitions were documented under its first machine's item path in the API its `apiSpec` named. Now each attaches to the resource it names, in whichever OpenAPI document of its domain declares it, so intake's Verification transitions appear under the verification. (#470)
