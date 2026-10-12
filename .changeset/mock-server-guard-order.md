---
"@codeforamerica/blueprint-mock-server": patch
"@codeforamerica/blueprint-core": minor
---

Before, a guarded action or create whose body was missing a field its condition read answered `409 No guard clause passed`, naming nothing. Now the body is checked against its schema after the caller's roles and before the conditions, answering 422, and a 409 names each condition not met, by the guard's new optional `description` or by its id. (#470)
