---
"@codeforamerica/blueprint-cli": minor
---

Before, `blueprint-resolve` wrote the whole contract set, and everything built from it covered all of it. Now `--api`, `--domain` and `--capability`, each repeatable, write only that part, with what it needs to stand on its own, so an explorer or mock built from the folder covers only that part: one API alone, for its own developer portal, with `--api`. (#543)
