---
"@codeforamerica/blueprint-core": patch
---

Validating a scenario now checks its actors: each actor in `info.x-actors` needs an id and a name, listed once, and a step's `x-actors` may name only those ids. (#517)
