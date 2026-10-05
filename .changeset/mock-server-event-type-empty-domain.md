---
"@codeforamerica/blueprint-mock-server": patch
---

Before, creating a resource under a spec that declares no localhost server URL emitted an event typed `".application.created"` — a leading dot and no domain, which nothing could subscribe to. Now the domain segment is omitted. (#448)
