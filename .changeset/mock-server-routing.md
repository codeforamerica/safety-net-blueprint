---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** Where you passed `--forwarding=<file>` or `createMockServer({ forwarding })`, pass `--routing=<file>` or `{ routing }`, whose entries name a domain (`*` for every domain, and any request the mock has no route for), an API or one operation in place of an `endpoint:`, with `to:` a URL or, in a page, a `handler` function (`schemas/routing-schema.json`). Routing also covers events, delivering those a routed domain receives to it as CloudEvents and reading those it sends that the mock's own state machines react to from its event stream, or its event log when it has none, and a WebSocket the mock serves, sent by its `api` name to a `ws` or `wss` URL or a `handler` with the WebSocket constructor's signature. (#283, #520)
