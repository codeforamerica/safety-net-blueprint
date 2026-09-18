---
"@codeforamerica/blueprint-core": minor
---

Restructure package exports from 17 scattered paths to 9 semantically grouped ones.

**Breaking changes:**

| Old import | New import |
|---|---|
| `blueprint-core/bundle` | `blueprint-core/openapi` |
| `blueprint-core/config` | `blueprint-core/overlay` |
| `blueprint-core/validation` | `blueprint-core/validator` |
| `blueprint-core/loader` | `blueprint-core/openapi` |
| `blueprint-core/patterns` | `blueprint-core/validator` (`validateApiPatterns`) |
| `blueprint-core/example-validator` | `blueprint-core/validator` |
| `blueprint-core/state-machine-validator` | navigation utilities → `blueprint-core/state-machines`; validation functions → `blueprint-core/validator` |
| `blueprint-core/rules-validator` | `blueprint-core/validator` |
| `blueprint-core/contract-validator` | `blueprint-core/validator` |
| Root `blueprint-core` (functions) | moved to their typed export (`./rules`, `./state-machines`, `./openapi`, `./relationships`) |

Root `blueprint-core` now exports only path constants: `schemasDir`, `baseContractsDir`, `resolverMap`.

`pattern-validator`'s `validateSpec` is exported as `validateApiPatterns` from `./validator` to avoid collision with the OpenAPI validator's `validateSpec`.

Schema navigation utilities (`resolveRef`, `resolveSchemaRefs`, `collectTopLevelProperties`, `getPropertyAtPath`) moved from `./state-machine-validator` to `./state-machines`.
