---
"@codeforamerica/blueprint-core": patch
---

Before, a `$ref` to a document that exists but has nothing at the pointer was reported as if the document were missing. Now the message names the document and the pointer that isn't in it. (#548)
