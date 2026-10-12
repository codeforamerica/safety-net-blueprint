---
"@codeforamerica/blueprint-safety-net-contracts": patch
---

The contracts' conditions are now written as CEL with no dialect — names without `$`, `has()` for fields that may be absent — so any CEL implementation evaluates them the way the mock server does. (#445)
