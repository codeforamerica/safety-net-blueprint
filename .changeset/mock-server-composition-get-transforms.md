---
"@codeforamerica/blueprint-mock-server": patch
---

Before, declaring `parentLink: true` on a composition silently turned off expand, links-only and derived fields for that resource's `GET` — the handler returned the record with `_links` before any of them ran. Now the links are merged into the transformed response. (#448)
