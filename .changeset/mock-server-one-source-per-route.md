---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** Before, when two contract documents declared the same route, the mock silently served whichever it registered first. Now it refuses to start, naming both documents. (#470)
