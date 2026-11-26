---
"@codeforamerica/blueprint-core": patch
---

Before, the session adapter's contract said every adapter gets a credential from `requestCredentials` when it starts. Now only an adapter whose service takes one does, so an adapter for a model running in the page needs no credentials part.
