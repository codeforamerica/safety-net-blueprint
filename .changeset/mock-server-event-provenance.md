---
"@codeforamerica/blueprint-mock-server": patch
---

Before, events from a request with no `traceparent` shared no trace, and state machine transitions recorded no `authid` or `authtype`. Now such a request starts a trace that every event it causes carries, and transition events record who acted, with `authtype` set whenever `authid` is. (#470)
