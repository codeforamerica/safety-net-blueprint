---
"@codeforamerica/blueprint-core": minor
"@codeforamerica/blueprint-mock-server": minor
"@codeforamerica/blueprint-safety-net-contracts": minor
---

**Breaking:** Every registry type a contract set declares is now served at `/platform/registry/{type}` and `/platform/registry/{type}/{entryId}`, with `/platform/registry` listing the types, read from the registry files themselves — files of a type combine, and an entry id two of them define fails, naming both. `safety-net-contracts` no longer declares `/registry/policies`, which the generic endpoint serves at the same URL. (#470)
