---
"@codeforamerica/blueprint-mock-server": minor
---

Before, reaching a real service meant leaving the mock entirely. Now `blueprint-mock --forwarding=<file>`, or `createMockServer({ forwarding })`, sends a whole domain or a single endpoint to a real service while everything else stays mocked, passing credentials along only where `includeHeaders` names them; `schemas/forwarding-schema.json` describes the file. (#283)
