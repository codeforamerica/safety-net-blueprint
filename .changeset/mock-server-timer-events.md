---
"@codeforamerica/blueprint-mock-server": minor
---

Before, `GET /platform/events` left out timer requests and cancellations, and a stub on `platform.timer.requested` fired only a timer asked for after it was registered. Now both are in the event log, and the stub fires a matching timer that's already waiting as soon as it's registered.
