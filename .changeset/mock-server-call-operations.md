---
"@codeforamerica/blueprint-mock-server": minor
---

The mock now performs an action's call to an operation where it stands in the steps: `runAs: caller` sends it through the API as the caller, so a refusal is the same 403, 409 or 422 they would get making it by hand, and the call's events name the action's as their `causationid`. A failed call runs the step's `onFailure:` instead of the action's steps and answers with the failure; with none, the action fails and nothing is saved. (#469)
