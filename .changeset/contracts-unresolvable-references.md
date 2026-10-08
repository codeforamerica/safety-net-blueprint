---
"@codeforamerica/blueprint-safety-net-contracts": patch
---

Before, validating or resolving the contract set reported references that named nothing in it: AsyncAPI documents pointing at a `schemas/events.yaml` that is not the canonical base events schema, and `x-relationship.resource` values naming a `domain/collection` path where a schema name belongs. Now every reference resolves. `EmployerInfo` is gone from `common/components/common.yaml` — it referenced a schema deleted in July, so it could not resolve either; use `Organization`, which carries the same fields. (#447)
