---
"@codeforamerica/blueprint-core": patch
---

`detectType` now returns `'policies'` for policy registry files (matched by `$schema: policies-schema.yaml` or the `-policies.yaml` filename suffix). Previously these files returned `'unknown'`.
