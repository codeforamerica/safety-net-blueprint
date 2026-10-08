---
"@codeforamerica/blueprint-mock-server": patch
---

Before, starting a second mock server in one process left the first one's event subscriptions attached, so every event was handled twice — a test suite had to clear listeners between runs to get a single result. Now registering subscriptions replaces the previous handler. (#448)
