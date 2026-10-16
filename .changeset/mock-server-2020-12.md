---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** The mock now validates in JSON Schema 2020-12, the dialect OpenAPI 3.1 contracts declare, so a request with a field a closed schema does not declare gets a 422 naming the field, where before `unevaluatedProperties: false` was ignored. (#461)
