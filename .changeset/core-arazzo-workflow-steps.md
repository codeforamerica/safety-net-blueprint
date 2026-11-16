---
"@codeforamerica/blueprint-core": patch
---

Before, `validate` didn't check a scenario step that runs another workflow, so a misspelled `workflowId` only showed when the scenario ran. Now it reports `unknown-workflow` for a workflow the document doesn't declare and, for `$sourceDescriptions.<name>.<workflowId>`, for one the named Arazzo document in the set doesn't declare; a source named this way that isn't of type `arazzo` is reported as `arazzo-shape`. (#520)
