---
"@codeforamerica/blueprint-mock-server": minor
---

Before, an Arazzo scenario could only call HTTP operations, one step at a time. Now `runScenario` also runs Arazzo 1.1 `send` and `receive` steps, for events on the mock's event stream and for WebSocket messages it serves at `/mock/ws/{document}` (answered by ws stubs at `POST /mock/stubs/ws` and reached through `createMockServer`'s `WebSocket`), and steps that run another workflow by `workflowId`; `operationIndex` includes AsyncAPI operations to match. (#520)
