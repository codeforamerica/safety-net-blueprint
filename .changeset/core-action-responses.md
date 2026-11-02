---
"@codeforamerica/blueprint-core": patch
---

Before, an endpoint generated from a state machine action listed only 400, 404, 409 and 500, and required a request body even when its schema required nothing. Now it also lists 403, and 422 when it takes a body or calls another operation, and its body is required only when its schema requires a field. (#469)
