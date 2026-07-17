# Resolve Pipeline Architecture

The resolve pipeline transforms base OpenAPI specifications and state-specific overlay files into fully-resolved output artifacts. It is the central mechanism by which the blueprint becomes customizable for individual state deployments.

> This document covers Stage 4 of the contracts build pipeline. For the full pipeline (validation, lint, resolve, and artifact generation), see [Contracts Build and Validation Pipeline](contracts-pipeline.md).

## Overview

```
base spec directory (--spec)         overlay directory (--overlay)
  *-openapi.yaml                       modifications.yaml
  *-openapi-examples.yaml              config.yaml
  components/                          (any structure)
  *-state-machine.yaml                 │
  *-compositions.yaml                  │
        │                              │
        └──────────────────────────────┤
                                       ▼
                              Apply overlays
                                       │
                    ┌──────────────────┘
                    ▼
           OpenAPI generation
           (RPC + composition resources)
           from *-state-machine.yaml
           and *-compositions.yaml
                    │
                    ▼
         Relationship resolution
                    │
                    ▼
           Example transform
                    │
                    ▼
              --out directory
                *-openapi.yaml        (merged spec)
                *-openapi-examples.yaml  (transformed)
                *-state-machine.yaml  (copied)
                *-sla-types.yaml      (copied, no overlay processing yet — see #174)
                *-metrics.yaml        (copied, no overlay processing yet — see #174)
```

## Pipeline Stages

### 1. Apply Overlays

If `--overlay` is specified, `resolve.js` applies all overlay files in the given directory to the base specs. Overlays can target any YAML file in the spec directory — including `*-openapi.yaml`, `*-state-machine.yaml`, and `*-compositions.yaml` files.

The overlay resolver (`packages/contracts/src/overlay/overlay-resolver.js`) applies JSON Merge Patch-style actions from an overlay file to the base spec. Actions can:

- Add or replace fields at any path
- Remove fields with `null` values
- Add array items (using `x-merge` directives)

The overlay path is specified via the `--overlay` flag to `resolve.js`. It can be a single file or a directory. When given a directory, the resolver walks it recursively and discovers all `.yaml` files with `overlay: 1.0.0` at the top level, applying them in alphabetical order. Within this repository the convention is `packages/contracts/overlays/<state>/`; in a state repository the path is whatever the state's scripts pass to `--overlay`.

### 2. OpenAPI Generation

After overlays have been applied, `resolve.js` generates OpenAPI paths and schemas from two source types:

**RPC endpoints** — `resolve.js` reads all `*-state-machine.yaml` files and generates RPC transition endpoints for each one (e.g. `POST /tasks/{id}/claim`), derived from the state machine's action definitions.

**Composition endpoints and schemas** — `resolve.js` reads all `*-compositions.yaml` files and generates composite view endpoints (e.g. `GET /applications/{id}/review`), state endpoints (e.g. `PATCH /applications/{id}/review-progress/{section}`), and the corresponding request/response schemas. If the composition sets `parentLink: true`, it also adds `_links.<compositionId>` to the parent resource's response schema. See [Resource Composition](cross-cutting/resource-composition.md) for the full config reference.

Because generation runs after overlays, any overlay modifications to `*-state-machine.yaml` or `*-compositions.yaml` files are reflected in the generated output.

### 3. Relationship Resolution

The relationship resolver (`packages/contracts/src/overlay/relationship-resolver.js`) processes `x-relationship` annotations on FK fields to determine how related resources should be represented in responses. The `style` property on each annotation controls the behavior:

| Style | Effect | Schema change |
|-------|--------|---------------|
| `links-only` (default) | `links` object added alongside FK field | `personId` + `links.person: "/persons/{id}"` |
| `expand` | FK field replaced with full object (or subset via `fields`) | `personId` → `person: {...}` |
| `include` | FK field included as-is | `personId` unchanged |

Output from `resolveRelationships`:
- `result` — the modified spec
- `warnings` — non-fatal issues
- `expandRenames` — field rename pairs for the expand style
- `linksData` — link name + base path pairs for the links-only style

**`x-relationship` is preserved in the resolved output** — both `expand` and `links-only` fields retain their `x-relationship` annotation after resolution. The mock server reads this at runtime to determine which fields to expand and which to populate with links URIs. Downstream tools that don't understand this extension (e.g. `@hey-api/openapi-ts`) strip it before processing — see [Output](#7-output) below.

For the behavioral contract of each style, see [x-relationship](../x-extensions.md#x-relationship).

By default, relationship resolution only runs when an overlay is present. Pass `--resolve` to run it on base specs without an overlay — useful for testing the resolver in isolation (e.g. functional test fixtures).

### 4. Example Transform

After resolving relationships, `resolveExampleRelationships` applies the same transformations to the corresponding `*-openapi-examples.yaml` file:

- For **expand** fields: replaces FK values with the related record from the examples index
- For **links-only** fields: adds a `links` object with URI values (`"links.assignedTo": "/users/{id}"`)

The examples index is built from all examples files by resource type so cross-API lookups work.

### 5. Environment Filtering

When `--env` is provided, the pipeline removes any spec node annotated with `x-environments` that doesn't include the target environment, then strips the `x-environments` key from remaining nodes.

```yaml
# In your overlay or resolved spec
paths:
  /debug/health:
    x-environments: [development, staging]
    get:
      summary: Health check (non-production only)
```

```bash
# Production: /debug/health is removed
safety-net-resolve --spec=... --overlay=... --out=./resolved --env=production

# Development: /debug/health is kept, x-environments is stripped
safety-net-resolve --spec=... --overlay=... --out=./resolved --env=development
```

Without `--env`, all sections are included as-is. See [x-environments](../x-extensions.md#x-environments) for the full extension reference.

### 6. Placeholder Substitution

When `--env-file` is provided or environment variables exist, `${VAR}` placeholders in string values are replaced with their resolved values.

```yaml
servers:
  - url: ${API_BASE_URL}
    description: API server
```

```bash
# .env file
API_BASE_URL=https://api.example.gov

safety-net-resolve --spec=... --overlay=... --out=./resolved --env-file=.env
```

Environment variables (`process.env`) take precedence over `.env` file values. Unresolved placeholders produce warnings but don't fail the build.

### 7. Output

Resolved specs are written to the path specified by `--out` (default: `packages/resolved/`). The resolved directory mirrors the structure of `packages/contracts/` but contains fully-merged, relationship-resolved artifacts.

By default, resolved specs preserve all `$ref` references — they are not inlined. This keeps the output readable and allows downstream tools (mock server, Postman generator) to follow references normally. Pass `--bundle` to inline all `$ref`s and produce self-contained single-file specs per domain — useful when distributing specs to external consumers or feeding them to tools that don't handle multi-file specs well.

```bash
# Default: preserve $refs
npm run resolve

# Bundled: inline all $refs into self-contained files
node packages/contracts/scripts/resolve.js --bundle --out=packages/resolved
```

The resolved directory is consumed by:
- `generate-postman.js` to produce the Postman collection
- `npm run mock:start -- --spec=packages/resolved` to run the mock with overlay behavior — the mock server relies on `x-relationship` annotations being present to drive expand and links-only behavior at runtime
- `npm run clients:typescript -- --spec=packages/resolved` to generate TypeScript clients — the client generator bundles specs internally and **strips `x-relationship` annotations by default** before passing to `@hey-api/openapi-ts`, since that tool does not use them and may produce unexpected output if they are present. Pass `--preserve-x-extensions` to keep vendor extensions in the generated output:

```bash
npm run clients:typescript -- --spec=packages/resolved --out=./src/api --preserve-x-extensions
```

## Invoking the Pipeline

The pipeline is driven by `resolve.js`. These npm scripts cover common invocations:

| Script | What it does |
|--------|-------------|
| `npm run resolve` | Run the full pipeline and write resolved specs to `packages/resolved/` |
| `npm run postman:generate` | Run the full pipeline with the example overlay, then generate the Postman collection |

Pass `--resolve` to force relationship resolution even without an overlay:

```bash
node packages/contracts/scripts/resolve.js --spec=my/fixtures --out=my/resolved --resolve
```

`npm run postman:generate` is a two-step pipeline:

```
resolve.js --spec=packages/contracts --overlay=packages/contracts/overlays --out=packages/resolved
generate-postman.js --spec=packages/resolved
```

For custom invocations (different overlay path, output directory, bundling, environment filtering):

```bash
node packages/contracts/scripts/resolve.js --help
```

## Testing

Integration tests run against a fixture-seeded server to exercise the full stack. See [Testing Guide](../guides/testing.md) for details on how the fixture pipeline works and how to run integration tests.

### Self-healing test pipeline

The integration test scripts are designed to work from a clean checkout without requiring manual setup steps:

- `generate-test-clients.js` checks whether `packages/resolved/` exists before generating clients. If it is missing or empty, it runs the resolve pipeline automatically.
- `run-all-tests.js --integration` checks whether `tests/generated/` exists before running integration tests. If it is missing or empty, it runs `generate-test-clients.js` automatically (which in turn ensures resolved specs exist).

This means `npm run test:integration` is safe to run at any time regardless of local state — it will resolve and generate whatever is needed.
