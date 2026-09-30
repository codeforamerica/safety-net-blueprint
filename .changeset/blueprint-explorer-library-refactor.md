---
"@codeforamerica/blueprint-explorer": minor
"@codeforamerica/blueprint-cli": patch
---

`blueprint-explorer` is now a proper library. Each build tool is exported as a named function (`buildContextMap`, `buildDataDictionaries`, `buildApiReference`, etc.) from the package root so consumers can import and call them directly rather than spawning subprocesses into `src/`.
