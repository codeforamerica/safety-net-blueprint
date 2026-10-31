---
"@codeforamerica/blueprint-mock-server": minor
---

The mock refuses a suggestion whose call names an operation the contracts don't have, or parameters or a body that operation doesn't accept, with a `422`, and one repeating a suggestion still open or dismissed with a `409`. Set `MOCK_FINGERPRINT_SECRET` so stored suggestions still match after a restart. (#469)
