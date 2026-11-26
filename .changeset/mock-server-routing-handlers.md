---
"@codeforamerica/blueprint-mock-server": minor
---

Before, a routing file could only send calls to a URL, and a handler was a function passed in code. Now a file's `handler` names a module of handlers by operationId, which `--routing` imports; a handler gets `{ params, publish, call }`; and entries with a `match` choose among implementations of one API per request, a later request about the same resource going to the same one. The routing schema moves to blueprint-core. (#549)
