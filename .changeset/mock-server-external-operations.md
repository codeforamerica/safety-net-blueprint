---
"@codeforamerica/blueprint-mock-server": minor
---

Before, the mock answered every operation whose path it could work out, an adapter's GET included. Now an operation marked `x-relationship: { type: external }` is answered only by an HTTP stub or by routing, and otherwise with 501 saying how to answer it. (#543)
