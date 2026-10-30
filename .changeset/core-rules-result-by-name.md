---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** A ruleset endpoint's response is described as an object keyed by output name, as the mock has always answered, where `EvaluationResult` said an array of facts each carrying a `fact` field. Read a result by name — `#/eligible/value` — and drop any lookup by position or by `fact`. Each ruleset's generated response schema now lists its outputs, each `value` typed as the ruleset declares it.
