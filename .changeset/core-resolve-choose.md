---
"@codeforamerica/blueprint-core": minor
---

Before, `resolve(docs, options)` always returned the whole set. Now `domains` and `capabilities` options keep only the documents declaring them and what they need to stand on their own: what they reference, the parts of platform they use, the contract of any API they call with its operations marked `x-relationship: { type: external }`, and the scenarios that can run, with a resource that was left out made `External`. (#543)
