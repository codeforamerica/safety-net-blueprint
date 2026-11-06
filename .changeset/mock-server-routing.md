---
"@codeforamerica/blueprint-mock-server": minor
---

Before, reaching a real service meant leaving the mock entirely. Now `blueprint-mock --routing=<file>`, or `createMockServer({ routing })`, hands a domain, an API or one operation to a real service at a URL, or in a page to a `handler` function, while everything else stays mocked — including the events a routed domain's state machines receive, which are delivered as CloudEvents instead of reacted to; `schemas/routing-schema.json` describes the entries. (#283, #520)
