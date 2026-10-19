---
"@codeforamerica/blueprint-core": minor
---

Before, a rule couldn't total a list, so totals like a member's income across jobs had to arrive as inputs. Now CEL expressions can call `list.sum()`, defined as Kubernetes' CEL list library defines it.
