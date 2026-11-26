---
"@codeforamerica/blueprint-mock-server": patch
---

Before, an operation routed to a handler ignored any HTTP stub registered for it. Now a stub answers first, as it does for an operation routed to a URL, so a scenario's stubs hold in a page that answers the same operation with a handler. (#549)
