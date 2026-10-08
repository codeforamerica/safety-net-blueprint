---
"@codeforamerica/blueprint-mock-server": minor
---

Before, running the mock server meant SQLite on disk and a native module. Now `--store=memory` keeps resources in memory with neither, and `createMemoryStore` is available on its own from the new `./store` export; SQLite stays the default. (#448)
