# Resolve Pipeline Architecture

The resolve pipeline transforms base OpenAPI specifications and state-specific overlay files into fully-resolved output artifacts. It is the central mechanism by which the blueprint becomes customizable for individual state deployments.

> This document covers Stage 4 of the contracts build pipeline. For the full pipeline (validation, lint, resolve, and artifact generation), see [Contracts Build and Validation Pipeline](contracts-pipeline.md).

## Overview

```
base spec directory (--spec)         overlay directory (--overlay)
  domains/*/
    *-openapi.yaml                     modifications.yaml
    *-openapi-examples.yaml            config.yaml  ← x-casing, x-relationship, etc.
    *-state-machine.yaml               (any structure)
    *-compositions.yaml                │
  common/                              │
        │                              │
        └──────────────────────────────┤
                                       ▼
                            1. Apply overlays
                                       │
                    ┌──────────────────┘
                    ▼
           2. Canonical URI ref rewriting
           (copy blueprint-core/base-contracts → out/base/,
            rewrite https://blueprint.codeforamerica.org/base/ URIs to relative paths)
                    │
                    ▼
           3. OpenAPI generation
           (RPC + composition resources)
           from *-state-machine.yaml
           and *-compositions.yaml
                    │
                    ▼
         4. Relationship resolution
                    │
                    ▼
           5. Example transform
                    │
                    ▼
         6. Environment filtering (--env)
                    │
                    ▼
         7. Placeholder substitution (--env-file)
                    │
                    ▼
              --out directory (packages/generated/contracts/)
                domains/*/
                  *-openapi.yaml        (merged spec, canonical URIs rewritten)
                  *-openapi-examples.yaml  (transformed)
                  *-state-machine.yaml  (copied)
                  *-sla-types.yaml      (copied)
                  *-metrics.yaml        (copied)
                base/                   (blueprint-core base contracts)
                  components/
                  schemas/
```

## Pipeline Stages

### 1. Apply Overlays

If `--overlay` is specified, `resolve.js` applies all overlay files in the given directory to the base specs. Overlays can target any YAML file in the spec directory — including `*-openapi.yaml`, `*-state-machine.yaml`, and `*-compositions.yaml` files.

The overlay resolver (`packages/blueprint-core/src/overlay/overlay-resolver.js`) applies JSON Merge Patch-style actions from an overlay file to the base spec. Actions can:

- Add or replace fields at any path
- Remove fields with `null` values
- Add array items (using `x-merge` directives)

The overlay path is specified via the `--overlay` flag to `resolve.js`. It can be a single file or a directory. When given a directory, the resolver walks it recursively and discovers all `.yaml` files with `overlay: 1.0.0` at the top level, applying them in alphabetical order.

The overlay directory may also contain a `config.yaml` file (not an overlay file itself — no `overlay:` key) that configures pipeline behavior via `config:` keys such as `x-casing`, `x-pagination`, and `x-relationship`. See [x-extensions](x-extensions.md) for the full config key reference.

**File type identification:** Throughout the pipeline, asset types are identified from spec content rather than filename patterns. Each spec type declares its type explicitly:

| Field | Value | Asset type |
|-------|-------|-----------|
| `$schema` | ends with `state-machine-schema.yaml` | State machine |
| `$schema` | ends with `sla-types-schema.yaml` | SLA types |
| `$schema` | ends with `compositions-schema.yaml` | Compositions |
| `$schema` | ends with `metrics-schema.yaml` | Metrics |
| `$schema` | ends with `rules-schema.yaml` | Rules |
| `openapi` | any string | OpenAPI spec |
| `asyncapi` | any string | AsyncAPI spec |
| `overlay` | `'1.0.0'` | Overlay file |

Filename patterns are only used in two places where no parsed spec is available: the startup quick-check that decides whether generators will run (avoids loading YAML for a no-op pipeline), and extracting a domain name for composition file → OpenAPI file matching.

### 2. Canonical URI Ref Rewriting {#base-ref-rewriting}

Shared components from `blueprint-core/base-contracts/` are referenced in domain specs using canonical `https://blueprint.codeforamerica.org/base/` URIs — stable identifiers that don't depend on relative file paths:

```yaml
# In source spec (intake-openapi.yaml)
parameters:
  - $ref: "https://blueprint.codeforamerica.org/base/components/parameters.yaml#/LimitParam"
  - $ref: "https://blueprint.codeforamerica.org/base/components/parameters.yaml#/OffsetParam"
```

The resolve pipeline automatically:

1. Copies all files from `blueprint-core/base-contracts/` into `{out}/base/`
2. Walks every spec file and rewrites `https://blueprint.codeforamerica.org/base/` URIs to real relative paths pointing to `{out}/base/`

```yaml
# In resolved output (packages/generated/contracts/domains/intake/intake-openapi.yaml)
parameters:
  - $ref: "../../base/components/parameters.yaml#/LimitParam"
  - $ref: "../../base/components/parameters.yaml#/OffsetParam"
```

The rewriting computes the correct relative path based on the spec file's location in the output directory, so specs at different nesting depths get different relative prefix depths.

This follows the standard JSON Schema / OpenAPI pattern of using canonical `$id` URIs as stable identifiers. The `blueprint-core` package exports a `resolverMap` that maps these URI prefixes to local directory paths, so validation tools (AJV) and other consumers can pre-load schemas by their canonical URI without hardcoding paths.

### 3. JSON Schema Validation {#json-schema-validation}

After all overlays, RPC endpoints, composition endpoints, enum source injections,
and event type prefix injections are applied, the pipeline validates all in-memory
YAML files that declare a `$schema` field against their referenced schemas.

**Why here and not earlier or later:**

- **After overlays** — schemas like `annotations-schema.yaml` reference `RoleType`
  and `Domain` from `base-contracts/schemas/enums.yaml`. Those enums are minimal
  in the base package; states extend them via overlay (e.g. adding `case_worker`,
  `applicant` to `RoleType`). Validating before overlays would reject every
  safety-net file that uses an extended value. Running here, the in-memory specs
  already contain the overlay-extended enums.
- **Before canonical URI rewriting** — cross-schema `$ref`s are still canonical
  `https://blueprint.codeforamerica.org/...` URIs at this point. AJV resolves
  these by URI lookup in its internal registry. After URI rewriting (step 8), refs
  become relative file paths that AJV cannot resolve via the registry.

**Schema loading order:**

In-memory specs are loaded into AJV first so overlay-extended schemas win. Then
blueprint-core validation schemas (`state-machine-schema.yaml`,
`annotations-schema.yaml`, etc.) are loaded via `resolverMap`, skipping any `$id`
already registered. This ensures `base/schemas/enums.yaml` always uses the
overlay-extended version.

**Files validated:**

Any YAML file declaring `$schema` with a non-HTTP value is validated. This includes
state machines, annotations, policies, config files, and domain-specific config
schemas. OpenAPI specs are validated separately by the OpenAPI validator post-resolve.

**Implementation:** `packages/blueprint-cli/scripts/validate/json-schema-core.js`
exports `validateSchemas(specs, { resolverMap })` — a pure function that works on
in-memory spec objects. This makes it usable both here and from the standalone CLI
(`validate/json-schema.js`). The standalone CLI is useful for ad-hoc debugging but
may produce false negatives on source files since overlays have not been applied.

### 4. OpenAPI Generation {#openapi-generation}

After overlays have been applied, `resolve.js` generates OpenAPI paths and schemas from two source types:

**RPC endpoints** — `resolve.js` reads all `*-state-machine.yaml` files and generates RPC transition endpoints for each one (e.g. `POST /tasks/{id}/claim`), derived from the state machine's action definitions.

**Composition endpoints and schemas** — `resolve.js` reads all `*-compositions.yaml` files and generates composite view endpoints (e.g. `GET /applications/{id}/review`), state endpoints (e.g. `PATCH /applications/{id}/review-progress/{section}`), and the corresponding request/response schemas. If the composition sets `parentLink: true`, it also adds `_links.<compositionId>` to the parent resource's response schema. See [Resource Composition](cross-cutting/resource-composition.md) for the full config reference.

Because generation runs after overlays, any overlay modifications to `*-state-machine.yaml` or `*-compositions.yaml` files are reflected in the generated output.

### 5. Relationship Resolution

The relationship resolver (`packages/blueprint-core/src/relationships.js`) processes `x-relationship` annotations on FK fields to determine how related resources should be represented in responses. The `style` property on each annotation controls the behavior:

| Style | Effect | Schema change |
|-------|--------|---------------|
| `links-only` (default) | `links` object added alongside FK field | `personId` + `links.person: "/persons/{id}"` |
| `expand` | FK field replaced with full object (or subset via `fields`) | `personId` → `person: {...}` |
| `include` | FK field included as-is | `personId` unchanged |

**`x-relationship` is preserved in the resolved output** — both `expand` and `links-only` fields retain their `x-relationship` annotation after resolution. The mock server reads this at runtime to determine which fields to expand and which to populate with links URIs. Downstream tools that don't understand this extension (e.g. `@hey-api/openapi-ts`) strip it before processing.

For the behavioral contract of each style, see [x-relationship](../x-extensions.md#x-relationship).

By default, relationship resolution only runs when an overlay is present. Pass `--resolve` to run it on base specs without an overlay — useful for testing the resolver in isolation.

### 6. Example Transform

After resolving relationships, `resolveExampleRelationships` applies the same transformations to the corresponding `*-openapi-examples.yaml` file:

- For **expand** fields: replaces FK values with the related record from the examples index
- For **links-only** fields: adds a `links` object with URI values (`"links.assignedTo": "/users/{id}"`)

The examples index is built from all examples files by resource type so cross-API lookups work.

### 7. Environment Filtering

When `--env` is provided, the pipeline removes any spec node annotated with `x-environments` that doesn't include the target environment, then strips the `x-environments` key from remaining nodes.

```yaml
paths:
  /debug/health:
    x-environments: [development, staging]
    get:
      summary: Health check (non-production only)
```

```bash
# Production: /debug/health is removed
blueprint-resolve --spec=... --overlay=... --out=./resolved --env=production

# Development: /debug/health is kept, x-environments is stripped
blueprint-resolve --spec=... --overlay=... --out=./resolved --env=development
```

Without `--env`, all sections are included as-is. See [x-environments](../x-extensions.md#x-environments) for the full extension reference.

### 8. Placeholder Substitution

When `--env-file` is provided or environment variables exist, `${VAR}` placeholders in string values are replaced with their resolved values.

```yaml
servers:
  - url: ${API_BASE_URL}
    description: API server
```

```bash
# .env file
API_BASE_URL=https://api.example.gov

blueprint-resolve --spec=... --overlay=... --out=./resolved --env-file=.env
```

Environment variables (`process.env`) take precedence over `.env` file values. Unresolved placeholders produce warnings but don't fail the build.

### 9. Output

Resolved specs are written to the path specified by `--out` (default: `packages/generated/contracts/`). The resolved directory mirrors the domain structure of the source specs but contains fully-merged, canonical-URI-rewritten, relationship-resolved artifacts alongside the copied `base/` directory.

By default, resolved specs preserve all `$ref` references — they are not inlined. This keeps the output readable and allows downstream tools (mock server, Postman generator) to follow references normally. Pass `--bundle` to inline all `$ref`s and produce self-contained single-file specs per domain — useful when distributing specs to external consumers or feeding them to tools that don't handle multi-file specs well.

```bash
# Default: preserve $refs
npm run resolve

# Bundled: inline all $refs into self-contained files
npm run resolve -- --bundle
```

The resolved output (`packages/generated/contracts/`) is consumed by:
- `npm run postman:generate` — produces the Postman collection
- `npm run mock:start` — the mock server relies on `x-relationship` annotations being present to drive expand and links-only behavior at runtime
- `npm run clients:typescript` — generates TypeScript clients; the client generator strips `x-relationship` annotations before passing specs to `@hey-api/openapi-ts`

## Invoking the Pipeline

The pipeline is driven by `packages/blueprint-cli/scripts/resolve.js` (bin: `blueprint-resolve`). Common npm scripts:

| Script | What it does |
|--------|-------------|
| `npm run resolve` | Run the full pipeline; write resolved specs to `packages/generated/contracts/` |
| `npm run postman:generate` | Run the pipeline, then generate the Postman collection |

Pass `--resolve` to force relationship resolution even without an overlay:

```bash
npm run resolve -- --spec=packages/safety-net-contracts --out=packages/generated/contracts --resolve
```

For all flags:

```bash
npm run resolve -- --help
```

## Key design decisions

| # | Decision | Summary |
|---|---|---|
| 1 | [State customization mechanism](#decision-1-state-customization-mechanism) | OpenAPI Overlay Specification over allOf inheritance, separate specs per state, or config-driven variants |

---

### Decision 1: State customization mechanism

**Status:** Decided

**What's being decided:** How states customize base contracts for their jurisdiction — enum values, additional fields, terminology differences, state-specific schemas — without forking the base repository.

**Considerations:**
- Safety net programs are 90%+ identical across states. The variation is real but proportional: a few enum values, a handful of state-specific fields, occasionally a fundamentally different schema for one resource.
- Any approach that requires states to maintain parallel copies of largely-identical specs creates a long-term maintenance burden — base fixes must be applied N times, and states drift apart.
- The OpenAPI Overlay Specification (v1.0.0, 2024) provides a standard declarative format for surgical modifications. Overlay actions target JSONPath expressions in base specs; changes are proportional to actual differences; overlays are auditable diffs. This is the pattern Redocly, Bump.sh, and other tooling vendors have aligned around.
- The blueprint extends the standard with two custom actions (`rename`, `replace`) and two-pass auto-detection (the resolver finds where each target exists rather than requiring explicit file scoping), but resolved output is standard OpenAPI that works with any downstream tool.

**Options:**

| Option | Considered | Chosen |
|--------|------------|--------|
| Fork per state | Yes | No |
| `allOf` schema inheritance | Yes | No |
| Separate specs per state in one repo | Yes | No |
| Config-driven variants (custom format) | Yes | No |
| OpenAPI Overlay Specification | Yes | **Yes** |

*Reconsider if:* A state needs customizations that can't be expressed as JSONPath modifications (e.g., wholesale restructuring of domain organization), or if the Overlay Specification tooling ecosystem fails to mature.

---

## Testing

Integration tests run against a fixture-seeded server to exercise the full stack. See [Testing Guide](../guides/testing.md) for details.

### Self-healing test pipeline

The integration test scripts work from a clean checkout without manual setup:

- `generate-test-clients.js` checks whether `packages/generated/contracts/` exists. If missing or empty, it runs the resolve pipeline automatically.
- `run-all-tests.js --integration` checks whether `tests/integration/generated/` exists. If missing or empty, it runs `generate-test-clients.js` automatically.

`npm run test:integration` is safe to run at any time — it resolves and generates whatever is needed.
