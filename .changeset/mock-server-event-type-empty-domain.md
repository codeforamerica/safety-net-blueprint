---
"@codeforamerica/blueprint-mock-server": patch
---

An event emitted for a spec that declares no localhost server URL no longer gets a malformed type. The domain prefix comes from that URL, and an empty one produced `".application.created"` — a leading dot and no domain, which nothing can subscribe to. The segment is now left out rather than emitted empty. (#448)
