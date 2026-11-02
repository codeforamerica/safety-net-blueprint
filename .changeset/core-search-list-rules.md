---
"@codeforamerica/blueprint-core": patch
---

Before, the `q` parameter's description didn't say how a condition on a list matches. Now it does: when any item matches, with each condition checked on its own, so `members.firstName:Jo members.age:>60` can match two different members. (#469)
