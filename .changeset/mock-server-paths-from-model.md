---
"@codeforamerica/blueprint-mock-server": patch
---

Before, the mock took a nested path for a collection or a singleton by whether its last word ends in "s", so a nested `people` or `children` collection could not be created. Now what each path is comes from core's model of the document. (#492)
