---
"@codeforamerica/blueprint-safety-net-contracts": patch
---

Fixed every reference that named something not in the contract set: 56 `$ref`s across eight AsyncAPI documents pointing at `schemas/events.yaml` instead of the canonical base events schema, and five `x-relationship.resource` values in `document-management-openapi.yaml` using a `domain/collection` path instead of a schema name. The `EmployerInfo` component is removed from `common/components/common.yaml` — it pointed at a schema deleted in July and is superseded by `Organization`, which carries the same fields. (#447)
