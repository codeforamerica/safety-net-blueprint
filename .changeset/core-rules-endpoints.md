---
"@codeforamerica/blueprint-core": minor
"@codeforamerica/blueprint-mock-server": patch
---

**Breaking:** A rules file's endpoints are documented in an OpenAPI document resolve generates beside it (`intake-rules-openapi.yaml`, from `generate(docs, 'rules-api')`), no longer merged into the domain's document, so clients generated from the domain's document no longer include them. Every ruleset now has an endpoint, at `/{domain}/rules/{ruleset-name}` unless it declares a path or `endpoint: false`. (#470)
