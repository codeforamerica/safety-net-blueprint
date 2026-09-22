---
"@codeforamerica/blueprint-core": minor
"@codeforamerica/blueprint-safety-net-contracts": patch
---

Added `registry-schema.yaml`, a generic schema for named registry files (`*-registry-{type}.yaml`). Registries define reusable, citable items keyed by stable ID; annotation files reference entries by ID using the registry type as the field name (e.g. `patterns: [external-ref-defs-oneOf]`).

`detectType` now returns `'policies'` for policy registry files, matched by `$schema: policies-schema.yaml` or the `-policies.yaml` filename suffix. Previously these returned `'unknown'` and were skipped by every consumer.

**Deprecated:** the `policies-schema.yaml` registry format (top-level `policies:` map) is superseded by `registry-schema.yaml` (`type: policies`, `entries:` map). Both formats remain supported. The old format will be removed in a future minor version.

**Removed** `overlays/policies-schema.yaml` from safety-net-contracts. It added a `programs` field to the base `Policy` type, but targeted a schema in `blueprint-core/schemas/` that is never part of the resolve input — so it never applied. No resolved output has ever contained `Policy.programs`, which is why removing it is not a breaking change.

It also had a second, independent defect worth recording, because the syntax is a trap: its target was written `$defs.Policy.properties`. The overlay path parser treats a leading `$` as the root marker and strips it, so that resolved to `[defs, Policy, properties]` and looked for a property named `defs`. Reaching a property literally named `$defs` requires `$.$defs` — the first `$` is consumed as the root, the second belongs to the name.

The capability that overlay reached for already exists in the registry format: registry `Entry` sets `additionalProperties: true` and names `programs` for policies as its example of a type-specific field. A state needing it adds it to the registry entry rather than patching core's schema — which also keeps validation schemas out of reach of the contracts they validate.
