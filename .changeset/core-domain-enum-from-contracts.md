---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** Before, a contract set extended the `Domain` enum with an overlay listing its domains. Now `Domain` is generated from the domains its OpenAPI, AsyncAPI and rules documents declare, through the new `x-enum-source: domains`, and validation reports any other document naming a domain none of them declare. (#470)
