---
"@codeforamerica/blueprint-mock-server": patch
---

Before, `GET /platform/events?start=...` matched `start` as a field on each event and found none. Now `start` and `end` return the events at or after and at or before those times.
