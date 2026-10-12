---
"@codeforamerica/blueprint-mock-server": minor
---

Before, a create or update outside an action ran no guards, and a context binding's `where` could only be field pairs or JSON Logic. Now creating or updating a resource runs the guards of every state machine that governs it under `resources:`, answering 403 or 409, and a `where` can be CEL. (#470)
