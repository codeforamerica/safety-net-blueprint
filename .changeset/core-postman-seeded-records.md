---
"@codeforamerica/blueprint-core": patch
---

Before, `generate(docs, 'postman')` put all of an API's endpoints in one folder when the API had a base path, and filled its requests with ids that often named no record in the mock. Now each resource gets its own folder, filled with the records a mock seeds from the same set.
