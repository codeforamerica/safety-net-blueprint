---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** Where you passed `--forwarding=<file>` or `createMockServer({ forwarding })`, pass `--routing=<file>` or `{ routing }`, whose entries name a domain, an API or one operation in place of an `endpoint:`, with `to:` a URL or, in a page, a `handler` function (`schemas/routing-schema.json`). The events a routed domain's state machines receive are delivered to it as CloudEvents instead of reacted to. (#283, #520)
