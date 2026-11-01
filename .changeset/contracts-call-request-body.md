---
"@codeforamerica/blueprint-safety-net-contracts": patch
---

Before, the state machines' calls sent their bodies as `body:`, now deprecated. Now they send `requestBody: {payload: …}`, so an overlay that targeted a call's `body` should target `requestBody.payload`. (#469)
