---
"@codeforamerica/blueprint-mock-server": minor
---

The mock server now automatically serves rules evaluation endpoints. Rulesets that declare an `endpoint:` in their `*-rules.yaml` file get a live POST endpoint at startup — no additional wiring required. Partial evaluation is supported: submit whatever inputs are available and the response includes resolved facts, placeholder values, and the specific input paths still needed to resolve pending outputs.
