---
"@codeforamerica/blueprint-core": patch
---

Before, validation took `GET /baskets/{basketId}` for a list when a basket has an `items` array, and demanded search, limit and offset parameters on it. Now a path ending in a parameter is never held to the list rules. (#534)
