---
"@codeforamerica/blueprint-mock-server": patch
---

Before, stubs registered on one mock server were still in place on the next one created in the same process. Now each server starts with none. (#470)
