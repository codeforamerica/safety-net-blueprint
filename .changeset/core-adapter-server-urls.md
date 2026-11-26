---
"@codeforamerica/blueprint-core": patch
---

The transcript audio adapter's local server is `http://localhost:1080`, where `blueprint-mock` answers it, rather than `http://localhost:9090`, where nothing did, and its servers are named "Production server" and "Local development server", as every other API's are. (#543)
