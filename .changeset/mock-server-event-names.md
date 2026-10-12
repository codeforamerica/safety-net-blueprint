---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** Create, update and delete events are named for the resource and the domain as declared — `intake.income.created` where it was `intake.application_income.created`, `data-exchange.…` where it was `data_exchange.…` — and a POST to a path with no list and no item answers 501 unless an HTTP stub stands in, where before it stored a record. (#470)
