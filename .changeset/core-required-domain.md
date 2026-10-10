---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** Before, a document's domain could come from its folder, its filename prefix or the `Domain` enum. Now it comes only from what the document declares — `info.x-domain` on OpenAPI and AsyncAPI, a top-level `domain` on any other document that belongs to a domain, mock data included — and validation reports one that declares none. (#470)
