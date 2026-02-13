# ADR: Restructure `@safety-net/schemas` to `@safety-net/contracts`

**Status:** Proposed

**Date:** 2026-02-13

**Deciders:** Development Team

---

## Context

The [contract-driven architecture](../architecture/contract-driven-architecture.md) introduces behavioral contracts — state machines, rules, metrics, form definitions — alongside the existing OpenAPI specs. The current `@safety-net/schemas` package and its `openapi/` subdirectory structure assume that OpenAPI specs are the only artifact type. As new artifact types are added, the package name and directory structure need to reflect the broader scope.

### Goals

- **Package name reflects scope** — consumers see `@safety-net/schemas` in import statements, which is misleading when the package also contains state machines, rules, metrics, and form definitions
- **Naming convention supports multiple artifact types** — each domain may have 1–6 artifacts (OpenAPI, state machine, rules, metrics, forms, examples); the convention must make it easy to discover all artifacts for a domain and validate cross-artifact consistency
- **No dependency on directory structure** — tooling discovers artifacts by filename convention (recursive glob `**/*-{suffix}.yaml`), not by directory path. The naming convention encodes domain and artifact type in the filename itself, so files can be reorganized into subdirectories later without breaking discovery, validation, or overlay resolution. The initial layout is flat (all artifacts at the package root) for simplicity and cross-artifact visibility, but this is a convention, not a constraint that tooling enforces
- **Convention is documented and enforced by tooling** — naming conventions only hold if they're discoverable by developers and violations are caught by validation before merge

### Constraints

- **Domain specs are self-contained** — all domain-specific schemas are defined inline. The only external `$ref`s point to shared `components/`, which has a fixed location and should not be moved. This means reorganizing domain files has zero `$ref` breakage
- **Non-breaking** — all validation, mock server, client generation, and overlay resolution must work after the restructure
- **Independently mergeable** to `main` (no dependency on other branches)
- **Mechanical only** — no behavioral changes

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

### `$ref` path updates

Each domain's OpenAPI spec is self-contained — all domain-specific schemas are defined inline rather than split across files. The only external `$ref`s point to shared components (`components/parameters.yaml`, `components/responses.yaml`, etc.), and shared components should not be moved. This means domain files can be reorganized freely without breaking any `$ref` paths.

- Component refs: `./components/parameters.yaml#/...` — unchanged (shared components stay in place)
- Example refs (same-domain): `./applications-examples.yaml#/...` &rarr; `./applications-openapi-examples.yaml#/...` — examples are the one same-domain cross-file ref, kept separate to avoid bloating the spec file. Domain specs and their examples should stay as siblings.
- No cross-domain refs: specs do not `$ref` into other domain specs

### Import updates (`packages/mock-server/` and `packages/clients/`)

All `@safety-net/schemas` imports &rarr; `@safety-net/contracts`:

**Source files:**
- `packages/mock-server/src/setup.js`
- `packages/mock-server/src/seeder.js`
- `packages/mock-server/scripts/swagger/server.js`
- `packages/mock-server/scripts/reset.js` (error message referencing `openapi/ directory`)
- `packages/clients/scripts/generate-postman.js`

**Test files:**
- `packages/mock-server/tests/unit/handlers.test.js` (hardcoded `../../../schemas/openapi` path)
- `packages/mock-server/tests/unit/schema-resolution.test.js` (hardcoded `schemas/openapi` path)
- `packages/mock-server/tests/unit/seeder.test.js` (hardcoded `../../../schemas/openapi` path)
- `packages/mock-server/tests/unit/openapi-validator.test.js` (hardcoded `../../../schemas/openapi` path)
- `packages/mock-server/tests/unit/openapi-loader.test.js` (hardcoded `../../../schemas/openapi` path)
- `packages/mock-server/tests/unit/overlay-resolver.test.js`
- `packages/mock-server/tests/integration/integration.test.js`

### Dependency updates

- `packages/mock-server/package.json`: `@safety-net/schemas` &rarr; `@safety-net/contracts`
- `packages/clients/package.json`: `@safety-net/schemas` &rarr; `@safety-net/contracts`

### Root `package.json` script updates

All `-w @safety-net/schemas` &rarr; `-w @safety-net/contracts`

### Source code path updates

All discovery scripts must use recursive filename glob (e.g., `**/*-openapi.yaml`) from the package root, not hardcoded directory paths. This ensures files can be reorganized without breaking tooling.

- `src/validation/openapi-loader.js`: use recursive glob for spec discovery
- `src/overlay/overlay-resolver.js`: use recursive glob for spec/overlay discovery
- `scripts/generate-api.js`: output paths, filename patterns (add `-openapi` suffix)
- `scripts/export-design-reference.js`: use recursive glob for spec discovery
- `scripts/validate-openapi.js`: use recursive glob
- `scripts/resolve-overlay.js`: use recursive glob
- `scripts/export-figma-data.js`: hardcoded `../openapi/examples` path
- `scripts/export-figma-plugin-data.js`: hardcoded `../openapi/components` and `../openapi/examples` paths
- `packages/mock-server/package.json`: script args referencing `../schemas/openapi` → `../contracts`

### CI updates

- `.github/workflows/ci.yml`: step name "Validate schemas" &rarr; "Validate contracts"

### `.gitignore` update

- `packages/schemas/openapi/resolved` &rarr; `packages/contracts/resolved` (or remove if `resolved/` is deleted)

### Package-internal docs

These files live inside `packages/schemas/` and move with the directory rename, but their contents also reference the old paths:

- `packages/schemas/figma-plugin/README.md`
- `packages/schemas/docs/ux-designer-guide.md`

### Documentation updates (~20 files)

All `packages/schemas` &rarr; `packages/contracts`, all `@safety-net/schemas` &rarr; `@safety-net/contracts`, all `openapi/` paths &rarr; new flat paths.

**Reference/guides:**
- `docs/reference/project-structure.md`: rewrite file layout section
- `docs/reference/commands.md`
- `docs/guides/validation.md`
- `docs/guides/state-setup-guide.md`

**Getting started:**
- `docs/getting-started/backend-developers.md`
- `docs/getting-started/frontend-developers.md`

**Integration:**
- `docs/integration/api-clients.md`
- `docs/integration/package-publishing.md`

**Architecture:**
- `docs/architecture/api-architecture.md`
- `docs/architecture/design-rationale.md`
- `docs/architecture/domain-design.md`
- `docs/architecture/README.md`
- `docs/architecture/cross-cutting/identity-access.md`

**Decisions:**
- `docs/decisions/state-customization.md`: update directory examples
- `docs/decisions/workspace-restructure.md`: add "Partially superseded" note (package name and directory structure superseded by this ADR)
- `docs/decisions/auth-patterns.md`

**Prototypes:**
- `docs/prototypes/application-review-prototype.md`

**Root:**
- `README.md`
- `.claude/CLAUDE.md` (local-only, not committed)

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

1. **Cross-artifact validation** — `npm run validate` discovers artifacts by recursive filename glob (`**/*-state-machine.yaml`, `**/*-openapi.yaml`, etc.) and checks that for every `{domain}-state-machine.yaml`, a matching `{domain}-openapi.yaml` exists. State machine states must match OpenAPI status enums. Effect targets must reference existing schemas. Rule context variables must resolve to real fields. (Validation rules added incrementally as artifact types are implemented.)

2. **Scaffolding script** — updated `generate-api.js` generates consistently-named files. Developers don't hand-create filenames.

3. **CI freshness check** — conversion scripts run in CI; generated YAML is diffed against committed files. Drift = failure. (Added when conversion scripts are built.)

4. **Convention documentation** — `project-structure.md` updated with naming rules, examples, and "how to add a domain" instructions.

---

## Extensibility

- **New domain:** run scaffold script or manually create `{domain}-openapi.yaml`. Add behavioral contracts when needed.
- **New artifact type:** choose a suffix, add to naming convention docs, create conversion script. Existing domains unaffected.
- **New version:** create `{domain}-{type}-v2.yaml`. Both versions coexist. Overlays target versions via `target-version`.
- **Authored table types:** open-ended. Any new type follows `authored/{domain}-{type}.csv` &rarr; `{domain}-{type}.yaml`.
- **Reorganize into subdirectories:** because tooling discovers by filename pattern (not directory path), domain specs are self-contained, and shared components stay in place, files can be moved into domain subdirectories (e.g., `applications/applications-openapi.yaml`) without breaking discovery, validation, `$ref` resolution, or overlay resolution.

---

## Verification

1. `npm install` — workspace resolves `@safety-net/contracts`
2. `npm run validate` — all renamed specs pass
3. `npm test` — unit tests pass with updated imports (including all 6 mock-server test files)
4. `npm run test:integration` — integration tests pass
5. `npm start` — mock server loads from new paths, Swagger UI works
6. `npm run overlay:resolve` — resolution works (may need temp overlay fixture)
7. `npm run design:reference` — export finds specs in new locations
8. `npm run api:new` — scaffold generates files with `-openapi` suffix at correct location
9. `grep -r '@safety-net/schemas' packages/ .gitignore .github/` — returns zero results (only docs/decisions/ may retain historical references)
10. `grep -r 'schemas/openapi' packages/` — returns zero results
11. CI passes

---

## References

- [Contract-driven architecture](../architecture/contract-driven-architecture.md)
- [Workspace restructure ADR](workspace-restructure.md)
- [State customization ADR](state-customization.md)
