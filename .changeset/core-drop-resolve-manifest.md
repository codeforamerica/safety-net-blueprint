---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** `resolve()` no longer returns a `manifest`, and a `Doc` no longer carries `provenance` or `resolved`. Nothing wrote the manifest file those fields were read from, so `resolved` was always `false` and `provenance` always `null`. (#448)
