---
"@codeforamerica/blueprint-mock-server": minor
---

Before, an Arazzo scenario could only call HTTP operations, so the events an API sends and the messages of a party reached over a WebSocket, such as a transcription relay, couldn't be shown or checked. Now Arazzo 1.1 `send` and `receive` steps run against the mock: events on its event stream, and WebSocket messages it serves at `/mock/ws/{document}` for an AsyncAPI document with servers, answered by ws stubs registered at `POST /mock/stubs/ws` and reached in a page or test through `createMockServer`'s `WebSocket`. (#520)
