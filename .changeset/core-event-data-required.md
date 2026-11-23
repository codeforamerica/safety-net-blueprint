---
"@codeforamerica/blueprint-core": patch
---

Before, a generated event schema left `data` optional even for an event that declares it. Now an event that declares its data requires it, so a typed client reads it without checking it's there. (#548)
