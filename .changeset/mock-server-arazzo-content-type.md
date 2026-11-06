---
"@codeforamerica/blueprint-mock-server": patch
---

Before, a scenario step's `requestBody.contentType` was ignored unless it was `multipart/form-data`, so a JSON Patch went out as `application/json`. Now the step is sent as the media type it names. (#516)
