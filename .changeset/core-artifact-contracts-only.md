---
"@codeforamerica/blueprint-core": patch
---

Before, `generate(docs, 'artifact')` carried every YAML file in the contracts directory, so a stray one — a mock forwarding file, a local config — was published in `contracts.json`. Now a file no contract type describes is left out unless a contract references it. (#283)
