---
"@codeforamerica/blueprint-core": patch
---

**Deprecated:** Where a state machine step wrote `call: {POST: some/path, body: {…}}`, write `call: {POST: some/path, requestBody: {payload: {…}}}`, as a call by `operationId` and an Arazzo step do. Validation warns about `body:`, and it will be removed in a future minor version. (#469)
