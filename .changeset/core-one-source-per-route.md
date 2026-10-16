---
"@codeforamerica/blueprint-core": minor
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** Before, a route two contract documents declared was served from one of them silently, and an operation written by hand where a state machine transition or composition endpoint is generated was silently replaced by the generated one. Now the mock refuses to start and resolve refuses to generate, each naming both sources. (#470)
