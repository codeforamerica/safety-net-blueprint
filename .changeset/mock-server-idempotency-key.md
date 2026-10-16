---
"@codeforamerica/blueprint-mock-server": minor
---

An operation that declares the `Idempotency-Key` header now honors it: a repeat with the same key gets the stored response marked `Idempotent-Replayed: true`, the same key with a different request gets 422 `IDEMPOTENCY_KEY_REUSED`, a missing required key gets 400 `IDEMPOTENCY_KEY_MISSING`, and keys are scoped to the caller. (#470)
