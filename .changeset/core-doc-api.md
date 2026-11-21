---
"@codeforamerica/blueprint-core": patch
---

Before, a tool that needed an API's name, or had to tell an events AsyncAPI document from a WebSocket API's, worked it out from the file name or the servers. Now every document that `load` and `extract(docs, 'docs')` return has `api`, such as `intake` or `communication-transcripts`, and `protocols`, such as `['http']`, `['ws']`, or `[]` for an events document, which the event bus carries.
