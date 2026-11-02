---
"@codeforamerica/blueprint-mock-server": patch
---

**Deprecated:** The mock reads a call's body from `requestBody: {payload: …}`. A call by method and path that still sends `body:` works, with a warning, until a future minor version removes it. (#469)
