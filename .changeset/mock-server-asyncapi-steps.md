---
"@codeforamerica/blueprint-mock-server": minor
---

Before, `runScenario` could only run steps that call HTTP operations. Now it also runs Arazzo 1.1 `send` and `receive` steps, for events on the mock's event stream and for messages on a WebSocket the mock serves for each AsyncAPI document with a localhost server, at that server's `pathname`, answered by stubs registered at `POST /mock/stubs/ws` and reached in a page through `createMockServer`'s `WebSocket` and over the network from `blueprint-mock`; `operationIndex` includes the AsyncAPI operations such steps name. (#520)
