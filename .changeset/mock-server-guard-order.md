---
"@codeforamerica/blueprint-mock-server": patch
"@codeforamerica/blueprint-core": minor
---

Before, a guarded action or create whose body was missing a field its condition read answered `409 No guard clause passed`, naming nothing. Now the body is checked against its schema first and answers 422, and a 409 reads as a sentence naming each unmet condition by the guard's new optional `description` or its id: `Can't create a transcript. It requires that …`. (#470)
