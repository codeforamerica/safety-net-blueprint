---
"@codeforamerica/blueprint-mock-server": minor
---

Run the server with `--store=memory` to hold resources in memory instead of SQLite — nothing written to disk and no native module loaded. SQLite stays the default. `createMemoryStore` is also available on its own from the new `./store` export, without Express or a native module. (#448)
