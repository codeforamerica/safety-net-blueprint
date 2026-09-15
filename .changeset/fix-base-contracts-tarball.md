---
"@codeforamerica/blueprint-core": patch
"@codeforamerica/blueprint-cli": patch
---

`blueprint-resolve` now exits with a clear error if `blueprint-core`'s base contracts are missing, rather than silently producing broken output. The base contracts directory is also now correctly included in the `blueprint-core` npm package, fixing resolution failures for consumers who installed from npm.
