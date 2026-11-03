---
"@codeforamerica/blueprint-core": minor
"@codeforamerica/blueprint-safety-net-contracts": minor
"@codeforamerica/blueprint-mock-server": minor
---

Before, the server always chose a new record's id. Now a create may carry the id the caller chose, and one another record already has gets 409. (#516)
