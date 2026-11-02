---
"@codeforamerica/blueprint-core": patch
---

Before, an action whose id has several words, such as `process-suggestions` on Interview, got the operationId `process-suggestionsInterview`. Now it's camelCased: `processSuggestionsInterview`. (#469)
