---
"@codeforamerica/blueprint-mock-server": patch
---

Before, a guarded action or create whose body was missing a field its condition read answered `409 No guard clause passed`, naming nothing. Now the body is checked against its schema after the caller's roles and before the conditions, answering 422, and a 409 names the condition that did not hold. (#470)
