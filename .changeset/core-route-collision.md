---
"@codeforamerica/blueprint-core": patch
---

Before, two OpenAPI documents declaring the same route — two adapters both at `POST /evaluate/determination`, say — passed `validate` and only stopped the mock from starting. Now `validate` reports it as `route-collision`, naming both documents. (#520)
