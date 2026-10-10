---
"@codeforamerica/blueprint-core": minor
"@codeforamerica/blueprint-mock-server": patch
"@codeforamerica/blueprint-safety-net-contracts": patch
---

**Breaking:** Before, a document's domain could come from its folder, its filename prefix or the `Domain` enum, which each contract set extended by overlay. Now every document that belongs to a domain declares it (`info.x-domain` on OpenAPI and AsyncAPI, a top-level `domain` elsewhere, mock data included), `Domain` is generated from the domains OpenAPI, AsyncAPI and rules documents declare, and validation reports a document that declares none or names one nothing defines. (#470)
