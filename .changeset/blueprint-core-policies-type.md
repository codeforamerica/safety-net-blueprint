---
"@codeforamerica/blueprint-core": patch
---

`detectType` now recognizes policies files — both by `$schema: policies-schema.yaml` and by the `-policies.yaml` filename suffix. Previously policies files returned `'unknown'`, causing them to be incorrectly removed from bundled resolve output.
