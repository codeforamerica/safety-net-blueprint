# ADR: Restructure `@safety-net/schemas` to `@safety-net/contracts`

**Status:** Proposed

**Date:** 2026-02-13

**Deciders:** Development Team

---

## Context

The [contract-driven architecture](../architecture/contract-driven-architecture.md) introduces behavioral contracts — state machines, rules, metrics, form definitions — alongside the existing OpenAPI specs. The current `@safety-net/schemas` package and its `openapi/` subdirectory structure assume that OpenAPI specs are the only artifact type. As new artifact types are added, the package name and directory structure need to reflect the broader scope.

### Requirements

- Package name reflects that it holds behavioral contracts, not just schemas
- File naming convention supports multiple artifact types per domain (OpenAPI, state machine, rules, metrics, forms)
- Flat directory structure — all contract artifacts for a domain are siblings, not nested in type-specific subdirectories
- Convention is documented and enforced by tooling
- Existing imports, CI, scripts, and documentation are updated consistently

### Constraints

- Must not break any existing functionality — all validation, mock server, client generation, and overlay resolution must work after the restructure
- Must be independently mergeable to `main` (no dependency on other branches)
- The restructure is mechanical — no behavioral changes

---

## Decision

Rename `packages/schemas/` to `packages/contracts/` and `@safety-net/schemas` to `@safety-net/contracts`. Flatten the `openapi/` subdirectory so that specs live at the package root with an `-openapi` suffix. Establish a naming convention that supports all behavioral contract artifact types.

---

## Changes

### Directory rename

`packages/schemas/` &rarr; `packages/contracts/`

### Package rename

`@safety-net/schemas` &rarr; `@safety-net/contracts` in `package.json`

### File renames

Add `-openapi` suffix and move from `openapi/` to the package root:

| Current path (under `packages/schemas/`) | New path (under `packages/contracts/`) |
|---|---|
| `openapi/applications.yaml` | `applications-openapi.yaml` |
| `openapi/applications-examples.yaml` | `applications-openapi-examples.yaml` |
| `openapi/households.yaml` | `households-openapi.yaml` |
| `openapi/households-examples.yaml` | `households-openapi-examples.yaml` |
| `openapi/incomes.yaml` | `incomes-openapi.yaml` |
| `openapi/incomes-examples.yaml` | `incomes-openapi-examples.yaml` |
| `openapi/persons.yaml` | `persons-openapi.yaml` |
| `openapi/persons-examples.yaml` | `persons-openapi-examples.yaml` |
| `openapi/users.yaml` | `users-openapi.yaml` |
| `openapi/users-examples.yaml` | `users-openapi-examples.yaml` |
| `openapi/components/` | `components/` |
| `openapi/patterns/` | `patterns/` |
| `openapi/overlays/` | deleted (example moves to california-overlay prototype; empty state dirs deleted) |
| `openapi/resolved/` | deleted or moved (generated output) |
| `openapi/examples/` | check contents — may be unused |

### New directories (empty, with .gitkeep)

- `authored/` — for future authored tables (CSV sources for generated YAML)
- `examples/` — for future runnable examples

### `$ref` path updates (~200+ across 10 YAML files)

- Cross-spec refs: `./persons.yaml#/...` &rarr; `./persons-openapi.yaml#/...`
- Example refs: `./applications-examples.yaml#/...` &rarr; `./applications-openapi-examples.yaml#/...`
- Component refs: `./components/parameters.yaml#/...` — unchanged (relative path still works after `components/` moves up with the specs)

### Import updates (13 files in `packages/mock-server/` and `packages/clients/`)

- `from '@safety-net/schemas/loader'` &rarr; `from '@safety-net/contracts/loader'`
- `from '@safety-net/schemas/validation'` &rarr; `from '@safety-net/contracts/validation'`
- `from '@safety-net/schemas/overlay'` &rarr; `from '@safety-net/contracts/overlay'`
- `from '@safety-net/schemas/patterns'` &rarr; `from '@safety-net/contracts/patterns'`

### Dependency updates

- `packages/mock-server/package.json`: `@safety-net/schemas` &rarr; `@safety-net/contracts`
- `packages/clients/package.json`: `@safety-net/schemas` &rarr; `@safety-net/contracts`

### Root `package.json` script updates

All `-w @safety-net/schemas` &rarr; `-w @safety-net/contracts`

### Source code path updates

- `src/validation/openapi-loader.js`: spec discovery paths (no longer in `openapi/` subdirectory)
- `src/overlay/overlay-resolver.js`: overlay/spec paths
- `scripts/generate-api.js`: output paths, filename patterns (add `-openapi` suffix)
- `scripts/export-design-reference.js`: spec discovery paths
- `scripts/validate-openapi.js`: paths
- `scripts/resolve-overlay.js`: paths
- `packages/mock-server/package.json`: script args referencing `../schemas/openapi`

### CI updates

`.github/workflows/ci.yml`: any path references

### Documentation updates (~35 files)

- All `packages/schemas` &rarr; `packages/contracts`
- All `@safety-net/schemas` &rarr; `@safety-net/contracts`
- All `openapi/` paths &rarr; new flat paths
- `docs/reference/project-structure.md`: rewrite file layout section
- `docs/decisions/state-customization.md`: update directory examples

---

## Naming Convention

Established by this restructure and documented in updated `project-structure.md`.

**Pattern:** `{domain}-{artifact-type}[-{version}][-examples].{ext}`

| Artifact type | Suffix | Generated from |
|---------------|--------|----------------|
| OpenAPI spec | `-openapi` | Hand-authored or scaffolded |
| OpenAPI examples | `-openapi-examples` | Hand-authored |
| State machine | `-state-machine` | Authored table (CSV) |
| Rules | `-rules` | Authored table (CSV) |
| Metrics | `-metrics` | Authored table (CSV) |
| Form definitions | `-forms` | Authored table (CSV) |

**Versioning:** no suffix = v1, `-v2`/`-v3` for breaking changes. Files live side by side.

**Authored tables:** same base name with `.csv` extension in `authored/` directory.

**Examples:**
```
packages/contracts/
  applications-openapi.yaml            # OpenAPI spec
  applications-openapi-examples.yaml   # seed data
  applications-state-machine.yaml      # generated from authored table
  applications-rules.yaml              # generated from authored table
  applications-metrics.yaml            # generated from authored table
  applications-forms.yaml              # generated from authored table
  authored/
    applications-state-machine.csv     # source for state machine YAML
    applications-rules.csv             # source for rules YAML
    applications-metrics.csv           # source for metrics YAML
    applications-forms.csv             # source for forms YAML
  components/                          # shared OpenAPI components
  patterns/                            # API pattern definitions
  examples/                            # runnable examples (prototypes)
```

---

## Brittleness Mitigation

1. **Cross-artifact validation** — `npm run validate` checks that for every `{domain}-state-machine.yaml`, a matching `{domain}-openapi.yaml` exists. State machine states must match OpenAPI status enums. Effect targets must reference existing schemas. Rule context variables must resolve to real fields. (Validation rules added incrementally as artifact types are implemented.)

2. **Scaffolding script** — updated `generate-api.js` generates consistently-named files. Developers don't hand-create filenames.

3. **CI freshness check** — conversion scripts run in CI; generated YAML is diffed against committed files. Drift = failure. (Added when conversion scripts are built.)

4. **Convention documentation** — `project-structure.md` updated with naming rules, examples, and "how to add a domain" instructions.

---

## Extensibility

- **New domain:** run scaffold script or manually create `{domain}-openapi.yaml`. Add behavioral contracts when needed.
- **New artifact type:** choose a suffix, add to naming convention docs, create conversion script. Existing domains unaffected.
- **New version:** create `{domain}-{type}-v2.yaml`. Both versions coexist. Overlays target versions via `target-version`.
- **Authored table types:** open-ended. Any new type follows `authored/{domain}-{type}.csv` &rarr; `{domain}-{type}.yaml`.

---

## Verification

1. `npm install` — workspace resolves `@safety-net/contracts`
2. `npm run validate` — all renamed specs pass
3. `npm test` — unit tests pass with updated imports
4. `npm run test:integration` — integration tests pass
5. `npm start` — mock server loads from new paths, Swagger UI works
6. `npm run overlay:resolve` — resolution works (may need temp overlay fixture)
7. `npm run design:reference` — export finds specs in new locations
8. CI passes

---

## References

- [Contract-driven architecture](../architecture/contract-driven-architecture.md)
- [Workspace restructure ADR](workspace-restructure.md)
- [State customization ADR](state-customization.md)
