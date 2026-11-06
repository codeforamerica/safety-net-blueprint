---
"@codeforamerica/blueprint-core": patch
---

Before, a transcript's `startedAt` was marked `readOnly` even though the client sets it at create. Now it isn't, and an update still can't change it. (#516)
