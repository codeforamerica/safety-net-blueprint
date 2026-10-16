---
"@codeforamerica/blueprint-core": minor
"@codeforamerica/blueprint-mock-server": patch
---

**Breaking:** before, a ruleset had an endpoint only if it declared one, and the endpoints were merged into the domain's OpenAPI document. Now every ruleset must declare `endpoint: {path}`, and a rules file's endpoints are documented in an OpenAPI document resolve generates beside it (`intake-rules-openapi.yaml`, from `generate(docs, 'rules-api')`), so clients generated from the domain's document no longer include them. (#470)
