---
"@codeforamerica/blueprint-mock-server": patch
---

Before, a step that read `$object` after a `set` saw the record as it was before the action began; a timer requested for a deadline just set got none. Now later steps see the value set. (#469)
