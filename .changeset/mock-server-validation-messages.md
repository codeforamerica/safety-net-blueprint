---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** an action's 422 says `VALIDATION_ERROR`, as every other 422 does, not `CONFLICT`; a client that checked for `CONFLICT` on a 422 checks for `VALIDATION_ERROR`. And where a request body refused with 422 said only "The request contains invalid data" or "Request body validation failed", the message now names each field and what's wrong with it, such as "The request body is invalid: at is required." (#544)
