---
"@codeforamerica/blueprint-mock-server": patch
---

Before, a request body refused with 422 said only "The request contains invalid data" or "Request body validation failed", and an action's said `CONFLICT`. Now the message names each field and what's wrong with it, such as "The request body is invalid: at is required.", and every 422 says `VALIDATION_ERROR`. (#544)
