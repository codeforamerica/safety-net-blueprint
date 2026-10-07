---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** stubs now use `response` where event stubs used `respond`; a stub sent with the old key is rejected with an error naming the rename. HTTP stubs must also carry a `response` — before, one registered without it returned an id, appeared in the list, matched, was consumed, and answered `200 {}`, which is indistinguishable from the mock handling the request normally.
