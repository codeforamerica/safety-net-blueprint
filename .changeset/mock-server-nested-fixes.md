---
"@codeforamerica/blueprint-mock-server": patch
---

Before, a nested list ignored its `x-sortable`, a nested create was validated with its parent ids already in the body so a create schema allowing no extra fields refused it, and a JSON Logic binding searched only the first 25 records. Now a nested list is ordered as declared, the body is validated as sent, and a binding searches every record. (#470)
