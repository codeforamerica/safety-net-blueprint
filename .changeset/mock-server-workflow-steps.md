---
"@codeforamerica/blueprint-mock-server": minor
---

Before, `runScenario` refused a step that runs another workflow. Now it runs one by `workflowId`, from the same document or, as `$sourceDescriptions.<name>.<workflowId>`, from another Arazzo document passed in `documents`, and a `workflows` option picks which workflows to run, each with those it depends on. (#520)
