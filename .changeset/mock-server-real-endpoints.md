---
"@codeforamerica/blueprint-mock-server": minor
---

Before, reaching a real service meant leaving the mock environment entirely. Now `createMockServer({ contracts, realEndpoints })` — or `blueprint-mock --real-endpoints=<file>` — forwards named routes to a real target while every other route stays mocked, and checks what comes back against the schema the contract declares, recording any disagreement at `GET /mock/conformance`. A `match` naming no route fails at boot, and an inbound `Authorization` or `Cookie` is not passed on unless `forwardHeaders` names it. (#283)
