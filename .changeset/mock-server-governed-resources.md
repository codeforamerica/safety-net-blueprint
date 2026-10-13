---
"@codeforamerica/blueprint-mock-server": minor
---

Before, a create or update outside an action ran no guards. Now it runs the guards of every state machine that governs the resource under `resources:`, answering 403 or 409. (#470)
