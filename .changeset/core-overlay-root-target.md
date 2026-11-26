---
"@codeforamerica/blueprint-core": patch
---

Before, an overlay action targeting `$`, the whole document, was skipped without a warning. Now an `update` on `$` merges its keys into the document, as the OpenAPI Overlay specification defines.
