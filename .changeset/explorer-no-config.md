---
"@codeforamerica/blueprint-explorer": patch
---

Before, building the explorer failed with ENOENT unless `config.yaml` and `context-map/config/config.yaml` existed. Now both are optional: the domains come from the contracts, the project is named "Blueprint", and the context map takes its title from that name. (#534)
