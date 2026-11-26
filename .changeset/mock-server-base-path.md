---
"@codeforamerica/blueprint-mock-server": patch
---

Before, a path that starts with the same word as its server's base — `/orders` in an API served at `/orders`, or `/menu-items` at `/menu` — was served without the base, and creating a record there answered 501. Now every path is served under its server's base. (#534)
