---
"@codeforamerica/blueprint-mock-server": minor
"@codeforamerica/blueprint-core": patch
---

Before, a state machine step with `runAs: caller` made its call with the caller's id and roles but not their credential. Now it also carries the `Authorization` header the caller sent, which routing passes on to a service where `includeHeaders` names it. (#520)
