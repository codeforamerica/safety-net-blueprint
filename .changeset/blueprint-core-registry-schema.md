---
"@codeforamerica/blueprint-core": minor
---

Added `registry-schema.yaml`, a generic schema for named registry files (`*-registry-{type}.yaml`). Registries define reusable, citable items keyed by stable ID; annotation files reference entries by ID using the registry type as the field name (e.g., `patterns: [external-ref-defs-oneOf]`).

**Deprecated:** The `policies-schema.yaml` registry format (top-level `policies:` map) is superseded by `registry-schema.yaml` (`type: policies`, `entries:` map). Both formats remain supported. The old format will be removed in a future minor version.
