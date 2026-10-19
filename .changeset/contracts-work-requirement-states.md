---
"@codeforamerica/blueprint-safety-net-contracts": minor
---

The package now ships `states/`, an overlay for each of Arkansas, Delaware, Idaho, Indiana, Iowa, North Carolina and Utah that sets the state's choices in the Medicaid and SNAP work requirements rulesets, including North Carolina's two SNAP exemptions. Apply one after the package's own overlays: `--overlay=…/src/overlays --overlay=…/states/nc.yaml`. (#496)
