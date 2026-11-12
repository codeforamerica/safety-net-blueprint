---
"@codeforamerica/blueprint-mock-server": minor
---

Before, an Arazzo scenario could only call HTTP operations, one step at a time. Now `runScenario` also runs Arazzo 1.1 `send` and `receive` steps, for events on the mock's event stream and for messages on a WebSocket the mock serves for each AsyncAPI document with a localhost server, at that server's `pathname` (answered by WebSocket stubs at `POST /mock/stubs/ws`, reached in a page through `createMockServer`'s `WebSocket` and over the network from `blueprint-mock`), and steps that run another workflow by `workflowId`; `operationIndex` includes AsyncAPI operations to match. Routing also takes such a socket by its `api` name, to a `ws` or `wss` URL or a `handler` with the WebSocket constructor's signature, and `routed` lists it as `WS <path>`. (#520)
