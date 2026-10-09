---
"@codeforamerica/blueprint-mock-server": patch
---

Before, a contract declaring a path the mock serves itself, such as `/health` or `/mock/stubs/http`, was never reached. Now the mock refuses to start and names the route. (#283)
