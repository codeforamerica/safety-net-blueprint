---
"@codeforamerica/blueprint-core": patch
---

Before, a state machine could write another domain's records with a call by path, which skips that domain's API and routing. Now `validate` warns about one as `call-by-path-across-domains`, saying to call the operation by its operationId. (#520)
