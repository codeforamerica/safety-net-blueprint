---
"@codeforamerica/blueprint-mock-server": minor
---

Before, a reaction with `transition:` to an event about another resource looked for a record whose id was the event's subject and was skipped. Now the mock transitions the machine's records that name the subject through their declared relationship. (#520)
