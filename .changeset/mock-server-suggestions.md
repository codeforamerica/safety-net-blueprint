---
"@codeforamerica/blueprint-mock-server": minor
---

The mock refuses a suggestion whose call names an operation the contracts don't have, parameters or a body that operation doesn't accept, or a JSON Patch with a change no `test` guards or a record that doesn't exist, with a `422`; and one repeating a suggestion still open or dismissed, or a patch whose `test` no longer holds, with a `409`. Set `MOCK_FINGERPRINT_SECRET` so stored suggestions still match after a restart. (#469, #517)
