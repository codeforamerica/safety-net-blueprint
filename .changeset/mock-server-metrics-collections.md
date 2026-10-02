---
"@codeforamerica/blueprint-mock-server": patch
---

A metric counting a collection other than `tasks` or `events` no longer answers 500. The metrics list endpoint prepared only those two collections, so a contract set measuring anything else — applications, determinations — crashed on an undefined lookup. The collections are now read from the metric definitions themselves. (#448)
