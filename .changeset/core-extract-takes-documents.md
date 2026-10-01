---
"@codeforamerica/blueprint-core": minor
---

`extract(docs, type)` now also reads `'state-machines'`, `'sla-types'`, `'metrics'` and `'config'`, and cross-file `$ref`s resolve against the documents passed in rather than being read off disk. `validate` is stricter in three ways, so a contract set that passed before may now report errors: a `$ref` naming a document outside the set, an `x-relationship.resource` naming no schema, and a state machine declaring `machines` without a `domain` are all errors instead of being silently ignored. (#448)
