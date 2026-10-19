---
"@codeforamerica/blueprint-explorer": minor
"@codeforamerica/blueprint-cli": minor
---

**Breaking:** Before, the explorer drew sequence diagrams and context-map flows from hand-written `flows:`, `actors:` and `sequence-diagrams/config/` files that drifted from the contracts. Now those are gone: remove `flows:` and `actors:` from your explorer `config.yaml`, which no longer validates with them, and stop calling `buildSequenceDiagrams` or `--only=sequence-diagrams`. (#311)
