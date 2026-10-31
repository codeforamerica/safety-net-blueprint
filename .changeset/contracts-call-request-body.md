---
"@codeforamerica/blueprint-safety-net-contracts": patch
---

Before, the state machines' calls sent their bodies as `body:`, which validation now warns about. Now they send `requestBody: {payload: …}`. (#469)
