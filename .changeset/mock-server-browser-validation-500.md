---
"@codeforamerica/blueprint-mock-server": patch
---

Before, a request that failed validation in a browser came back as `500 INTERNAL_ERROR: process is not defined` — the debug-logging line on the failure path read a bare `process.env`, which is a ReferenceError in a page. Now it reads through `globalThis`, so a rejected request returns the 422 naming the field, as it already did in Node. (#460)
