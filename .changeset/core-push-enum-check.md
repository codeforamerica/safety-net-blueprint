---
"@codeforamerica/blueprint-core": patch
---

Before, validation accepted a state machine call that `$push`es an item with a value its list doesn't allow, such as `{source: not_a_real_source}`. Now that's an `invalid-push-enum-value` error. (#469)
