---
"@codeforamerica/blueprint-cli": patch
---

`blueprint-resolve` now applies the `x-event-type-prefix` overlay config to annotation event keys, so resolved contracts stay consistent across all artifact types (state machine, AsyncAPI, and annotations).
