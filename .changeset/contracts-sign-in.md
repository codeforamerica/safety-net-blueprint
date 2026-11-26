---
"@codeforamerica/blueprint-safety-net-contracts": minor
---

**Breaking:** Before, only the users API declared that callers send the identity provider's JWT. Now every safety net API requires it, as the contract set's shared scheme, with `userId`, `roles` and `counties` as the claims that identify the caller; the users API keeps its own API key for the token enrichment call. (#473)
