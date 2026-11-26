---
"@codeforamerica/blueprint-cli": minor
---

Before, `blueprint-resolve` resolved for one environment, and stopped on any `${VAR}` without a value. Now `--env-overlay` applies an environment's own overlay last, and `--build` resolves without an environment, keeping the `${VAR}`s for a later release. `blueprint-build-explorer` takes that build when `config.yaml` lists environments. (#473)
