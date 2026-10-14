---
"@codeforamerica/blueprint-explorer": patch
---

Before, the data dictionary documented only resources with a PATCH operation, so a domain whose resources are read-only got no dictionary at all. Now any `/{collection}/{id}` that returns a record is documented from what it returns; a GET that answers with a page of records is not taken for one. (#481)
