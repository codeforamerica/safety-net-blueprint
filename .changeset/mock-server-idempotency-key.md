---
"@codeforamerica/blueprint-mock-server": minor
---

An operation that declares the `Idempotency-Key` header now honors it: a repeat with the same key gets the stored response, the same key with a different request gets 422, and keys are scoped to the caller. (#470)
