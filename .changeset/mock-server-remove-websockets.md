---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** The mock no longer serves a WebSocket for an AsyncAPI document with servers of its own. WebSocket stubs (`/mock/stubs/ws`), `createMockServer`'s `WebSocket`, routing a socket, and scenario steps that send or receive over a WebSocket are removed, and `ws` is no longer installed. A scenario step on such a document is refused, naming it.
