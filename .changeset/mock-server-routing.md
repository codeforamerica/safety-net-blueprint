---
"@codeforamerica/blueprint-mock-server": minor
---

Before, reaching a real service meant leaving the mock entirely. Now `blueprint-mock --routing=<file>`, or `createMockServer({ routing })`, hands a domain, an API or one operation to a real service at a URL, or in a page to a `handler` function, while everything else stays mocked — including events: those a routed domain receives are delivered to it as CloudEvents, and those it sends that the mock's own state machines react to are read from its event stream, or its event log when it has none; `schemas/routing-schema.json` describes the entries. (#283, #520)
