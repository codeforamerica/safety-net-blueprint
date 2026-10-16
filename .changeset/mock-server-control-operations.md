---
"@codeforamerica/blueprint-mock-server": minor
"@codeforamerica/blueprint-core": minor
---

A scenario can now call the mock's own routes, such as registering a stub, by the operationIds in `contracts/mock-openapi.yaml` (`controlOperations(mock)` gives them to `runScenario`), with each step qualified as `$sourceDescriptions.<name>.<operationId>` when it names more than one source. (#470)
