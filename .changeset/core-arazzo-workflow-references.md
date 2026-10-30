---
"@codeforamerica/blueprint-core": patch
---

Validating a scenario now checks references between its workflows: `$workflows.<id>.outputs.<name>` must name a workflow the step's own `dependsOn` lists, and an output it declares, and `dependsOn` must name a workflow the document has. (#469)
