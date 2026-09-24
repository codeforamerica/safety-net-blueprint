---
"@codeforamerica/blueprint-cli": minor
---

The TypeScript client generator now includes a `Rules` export for domains with compiled rule graphs (`*-graph.yaml`). `domain.Rules.rulesetName.evaluate(inputs)` runs the graph locally in the browser with no network call. Each ruleset gets fully typed inputs and results — `${Ruleset}Inputs` and `${Ruleset}Result` are exported from the domain client package alongside the API functions and types. Requires `@codeforamerica/blueprint-rules-engine` as a peer dependency when rules are used.
