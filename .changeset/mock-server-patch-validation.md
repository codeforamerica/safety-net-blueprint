---
"@codeforamerica/blueprint-mock-server": patch
---

Before, a PATCH was merged into the stored record and the result checked against the update schema, so an update schema that allows no other fields — the framework's own `TranscriptionProfileUpdate` among them — refused every change. Now the request body is checked against the update schema, and the record it leaves against the resource's schema. (#534)
