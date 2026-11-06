---
"@codeforamerica/blueprint-core": patch
---

Before, a retried `addTranscriptEntry` came back with an `Idempotent-Replayed` header no contract declared. Now the base components declare it as `IdempotentReplayed` in `components/headers.yaml`, and every operation that takes an `Idempotency-Key` lists it on its success response. (#516)
