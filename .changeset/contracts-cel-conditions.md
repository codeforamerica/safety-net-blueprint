---
"@codeforamerica/blueprint-safety-net-contracts": minor
---

**Breaking:** workflow's metric filters and SLA `pauseWhen` conditions, and eligibility's lookup of a pending service call, are written in CEL; the values they compute are unchanged. An overlay that edits inside one of these expressions now replaces the whole string, e.g. `pauseWhen: object.status in ["awaiting_client", "awaiting_verification"]`. (#413)
