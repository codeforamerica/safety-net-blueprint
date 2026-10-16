---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** Before, a POST to a path with no list and no item stored a record. Now it answers 501 unless an HTTP stub stands in. (#470)
