---
"@codeforamerica/blueprint-core": minor
---

Before, nothing in a contract said an operation was answered outside the contracts. Now `x-relationship: { type: external }` on an operation says so, and the transcription session adapter's operations declare it. (#543)
