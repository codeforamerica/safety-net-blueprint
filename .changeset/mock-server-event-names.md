---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** Before, create, update and delete events were named from the path, as `intake.application_income.created` or `data_exchange.…`. Now they are named for the resource and the domain as declared: `intake.income.created`, `data-exchange.…`. (#470)
