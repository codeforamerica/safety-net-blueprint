---
"@codeforamerica/blueprint-safety-net-contracts": minor
---

**Breaking:** `x-data-classification` on `DocumentVersion.uploadedById` and `DocumentLink.linkedBy` is now the list `[pii]` the convention defines, not the single value `pii`; read it as a list.
