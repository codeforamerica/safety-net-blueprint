---
"@codeforamerica/blueprint-core": patch
---

Before, the mock refused a session adapter's `202 {}` from `startStream`, `pauseStream` or `stopStream` with 502, since `StreamResponse` requires `metadata` and gave no example. Now `StreamResponse` has an example, `{ metadata: {} }`, which is what a stand-in answers with.
