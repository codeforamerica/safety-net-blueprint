---
"@codeforamerica/blueprint-core": minor
---

A state machine's `extends` now resolves by its path from the extending file, as a `$ref` does. Before, it matched any state machine with the same filename anywhere in the set, so it could pick the wrong one; a set whose `extends` path doesn't lead to the file now gets an error naming it. Bundling one domain with `--domain` now keeps the state machine it extends. (#520)
