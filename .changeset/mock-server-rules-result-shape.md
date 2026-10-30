---
"@codeforamerica/blueprint-mock-server": patch
---

Before, the mock answered a ruleset's endpoint with an object keyed by fact name, where `EvaluationResult` in `rules-evaluation.yaml` says an array. Now it answers with the array: each output fact, in order, as `{fact, state}` with `value`, `missing` or `message` as its state carries.
