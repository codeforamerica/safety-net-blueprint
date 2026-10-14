---
"@codeforamerica/blueprint-mock-server": patch
---

Before, a composition field written as `source as alias` was silently left out of the response. Now the source field's value is returned under the alias, nested paths included. (#481)
