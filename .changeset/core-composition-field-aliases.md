---
"@codeforamerica/blueprint-core": patch
---

Before, a composition field written as `source as alias`, the form the compositions schema documents, failed validation as a field named `source as alias`. Now the source field is checked. (#481)
