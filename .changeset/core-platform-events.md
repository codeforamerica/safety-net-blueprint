---
"@codeforamerica/blueprint-core": minor
"@codeforamerica/blueprint-safety-net-contracts": minor
---

**Breaking:** The event log's API (`/platform/events`, its stream, single events and publishing) now comes with the framework in every resolved contract set, and `safety-net-contracts` no longer declares its own. A contract set that declares `/platform/events` itself must remove it. (#470)
