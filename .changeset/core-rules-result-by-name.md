---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** A ruleset endpoint's response is now described as an object keyed by output name, where `EvaluationResult` described an array of facts each with a `fact` field: read a result by name, as `#/eligible/value`. Each ruleset's generated response schema lists its outputs, each `value` typed as the ruleset declares it. (#469)
