---
"@codeforamerica/blueprint-core": minor
---

Before, routing was the mock server's, and checked only when a mock started. Now blueprint-core defines it, in `schemas/routing-schema.yaml`, and `validateRouting(document, docs)` checks a routing file against the schema and the contracts it routes, listing every problem, with `match` to choose among implementations of one API and `handler` naming a module in a file. (#549)
