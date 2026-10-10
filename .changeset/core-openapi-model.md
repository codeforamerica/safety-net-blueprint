---
"@codeforamerica/blueprint-core": minor
---

Before, `model()` returned null for an OpenAPI document. Now it returns the document's server base and the resources it serves, each named for the schema its item endpoint returns and linked to its parent and children, with `path()` writing its item or collection path. (#470)
