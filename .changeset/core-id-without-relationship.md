---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** A writable field named `…Id` that holds a uuid must now declare `x-relationship`, or validation fails with `id-without-relationship`; before, it passed as a link that nothing could follow. (#481)
