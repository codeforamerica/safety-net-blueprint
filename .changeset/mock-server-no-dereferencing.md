---
"@codeforamerica/blueprint-mock-server": minor
---

Before, a spec with a `$ref` naming something outside the contract set stopped the server from starting. Now it starts, and warns that no validator could be compiled for that schema — so requests to the affected endpoint are accepted unchecked. `blueprint-validate` reports the bad ref instead. (#448)
