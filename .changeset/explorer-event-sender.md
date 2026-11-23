---
"@codeforamerica/blueprint-explorer": patch
---

Before, the event catalog didn't say who sends an event an adapter publishes. Now it names the adapter, from an AsyncAPI document marked `x-relationship: { type: external }` whose send operations refer to the event's channel. (#548)
