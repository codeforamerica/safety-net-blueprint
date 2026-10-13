---
"@codeforamerica/blueprint-cli": patch
---

Before, `blueprint-resolve --bundle` failed on a schema that refers to a `https://blueprint.codeforamerica.org/schemas/...` URL. Now those URLs are read from the installed blueprint. (#470)
