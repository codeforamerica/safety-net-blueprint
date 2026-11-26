---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** `blueprint-swagger` is removed, and `express` and `swagger-ui-express` are no longer installed. To browse and try a contract set's APIs, build the explorer with `blueprint-build-explorer`: its API reference sends each request to a mock running in the page. (#465)
