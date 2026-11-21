---
"@codeforamerica/blueprint-core": patch
---

Before, closing a transcript left its idle check waiting at the timer service. Now closing a transcript cancels it.
