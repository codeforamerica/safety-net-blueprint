---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** Where you passed `generate(docs, 'overlay')` to `resolve`, pass only your own overlays: `resolve` now adds the endpoints compositions, rulesets and state machine actions imply, and the rules API and events AsyncAPI documents, after applying them, so they follow what the overlays changed. `generate` no longer offers `'overlay'`. (#500)
