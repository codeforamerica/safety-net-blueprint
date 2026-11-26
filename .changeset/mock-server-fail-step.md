---
"@codeforamerica/blueprint-mock-server": patch
---

Before, a reaction failed only when a call it made failed. Now a `fail` step stops an action, which answers with its status, code and message, or a reaction, which logs it; either way nothing it did is saved.
