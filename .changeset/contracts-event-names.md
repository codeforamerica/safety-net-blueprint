---
"@codeforamerica/blueprint-safety-net-contracts": minor
---

**Breaking:** Events are named for the resource that sends them, with hyphenated domains as declared: for example `eligibility.decision.completed` where it was `eligibility.application.decision_completed`, and `data-exchange.call.completed` where it was `data_exchange.call.completed`. (#470)
