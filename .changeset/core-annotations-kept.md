---
"@codeforamerica/blueprint-core": patch
---

Before, resolved contracts lost `x-enum-source` and the `x-environments` marker once resolve had used them. Now resolve keeps every annotation an author wrote beside what it fills in from it, so a reader can still tell where an `enum` came from.
