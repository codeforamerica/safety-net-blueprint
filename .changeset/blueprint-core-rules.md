---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** JSON schema validation no longer strips the `$schema` field before validating documents. Schemas with `additionalProperties: false` that do not declare `$schema` as an allowed property will now fail validation. To fix, add `$schema: {type: string}` to the `properties` section of any such schema.

`blueprint-core` now includes rules contract support: a schema for authoring `*-rules.yaml` files, a compiler that produces portable `*-graph.yaml` dependency graphs, a validator with cycle detection, unreachable node detection, and CEL expression syntax checking, and a standalone endpoint overlay generator for rulesets that declare an HTTP endpoint. The `operationId` for generated rules endpoints is derived from the declared endpoint path (e.g. `/notices/evaluate-urgency` → `evaluateUrgency`) rather than the ruleset name. The graph schema is also available for validating compiled graph files directly.
