---
"@codeforamerica/blueprint-cli": patch
---

Before, `blueprint-resolve` built rules graphs, and the endpoints compositions and state machines imply, from the contracts as written, so a state's overlay changed the documents it targeted but not what was generated from them, and the engine ran the base ruleset. Now they're generated after overlays. (#467, #500)
