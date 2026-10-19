---
"@codeforamerica/blueprint-mock-server": patch
---

Before, a guarded action or create whose body was missing a field its condition read answered `409 No guard clause passed`, naming nothing. Now the body is checked against its schema first and answers 422, and a 409 reads as a sentence naming each unmet condition by the guard's new optional `description` or its id, or the states an action needs: `Can't pause this transcript. It requires that the transcript is recording, and it is closed.` (#470)
