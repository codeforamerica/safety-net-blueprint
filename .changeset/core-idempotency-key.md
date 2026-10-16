---
"@codeforamerica/blueprint-core": minor
---

The base components now include `IdempotencyKeyParam`, an `Idempotency-Key` header an operation lists to require one key per create, and an `IdempotencyKeyReused` response for a key reused with a different request. (#470)
