---
"@codeforamerica/blueprint-core": minor
---

Before, `resolve(docs, options)` always returned the whole set. Now `apis`, `domains` and `capabilities` options keep only that part and what it needs to stand on its own: what it references, the parts of platform it uses, the contract of any other API it calls or references with its operations marked `x-relationship: { type: external }`, and the scenarios that can run, with a resource left out made `External`; an API brings the state machines, annotations, sample records and the rest about its resources, cut to those. (#543)
