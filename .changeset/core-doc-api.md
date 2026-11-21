---
"@codeforamerica/blueprint-core": patch
---

Before, a tool that needed an API's name, the one the mock's routing and `$apis.<api>.<id>` references use, had to work it out from the document's file name. Now every OpenAPI and AsyncAPI document that `load` and `extract(docs, 'docs')` return has `api`, such as `intake` or `communication-transcripts`, and an events AsyncAPI document has its API's name.
