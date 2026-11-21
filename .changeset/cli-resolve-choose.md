---
"@codeforamerica/blueprint-cli": minor
---

Before, `blueprint-resolve` wrote the whole contract set, and everything built from it covered all of it. Now `--domain` and `--capability`, each repeatable, write only that part, with what it references, the parts of platform it uses and the scenarios that fit, so an explorer or mock built from the folder covers only that part. (#543)
