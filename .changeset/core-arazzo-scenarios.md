---
"@codeforamerica/blueprint-core": minor
---

A contract set can now include Arazzo scenarios — files ending `.arazzo.yaml`, declaring their domain in `info.x-domain` — which resolve carries with the other contracts and `validate` checks: each step must call an operation the set has, generated ones included, and refer only to earlier steps. (#470)
