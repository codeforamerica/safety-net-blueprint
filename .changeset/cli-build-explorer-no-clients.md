---
"@codeforamerica/blueprint-cli": minor
---

**Breaking:** `blueprint-build-explorer` no longer builds a Client Reference, so `--clients` is ignored and `--only=client-reference` rebuilds only the home page. Drop `--clients` from your command; the API reference shows each operation's TypeScript call instead. (#465)
