---
"@codeforamerica/blueprint-mock-server": minor
---

The mock refuses a suggestion that repeats one still open or dismissed, with `409` naming it, and stores each suggestion's `fingerprint`: an HMAC-SHA-256 made with Web Crypto, in Node and in a page. Set `MOCK_FINGERPRINT_SECRET` for its key so a stored suggestion still matches after a restart; without it, a key is generated when the mock starts. (#469)
