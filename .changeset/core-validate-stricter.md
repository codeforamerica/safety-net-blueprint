---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** before, `validate` silently ignored a `$ref` naming a document outside the set, an `x-relationship.resource` naming no schema, and a state machine declaring `machines` without a `domain`. Now each is an error, so a contract set that passed before may report new ones. (#448)
