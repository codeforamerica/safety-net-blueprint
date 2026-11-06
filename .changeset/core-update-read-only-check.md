---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** An update operation whose request schema takes a field the record it returns marks `readOnly` now fails validation; take the field off the update, or change it through a state machine action. (#516)
