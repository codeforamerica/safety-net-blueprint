# Resolve Pipeline Architecture

The resolve pipeline transforms base OpenAPI specifications and state-specific overlay files into fully-resolved output artifacts. It is the central mechanism by which the blueprint becomes customizable for individual state deployments.

## Overview

```
base spec directory (--spec)         overlay directory (--overlay)
  *-openapi.yaml                       modifications.yaml
  *-openapi-examples.yaml              config.yaml
  components/                          (any structure)
  *-state-machine.yaml ──┐
  *-rules.yaml           │
        │                │ auto-generate RPC overlays
        │           ┌────┘
        │           ▼
        │    RPC overlay generation
        │    (one per state machine)
        │           │
        └───────────┤
                    │ + explicit overlays
                    ▼
           Overlay merge
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
                *-rules.yaml          (copied)
                *-sla-types.yaml      (copied, no overlay processing yet — see #174)
                *-metrics.yaml        (copied, no overlay processing yet — see #174)
```

## Pipeline Stages

### 1. RPC Endpoint Generation

Before any explicit overlay is applied, `resolve.js` discovers all `*-state-machine.yaml` files in the spec directory and generates an overlay for each one. Each overlay adds the RPC transition endpoints (e.g. `POST /tasks/{id}/claim`) to the corresponding API spec, deriving them from the state machine's triggers.

These generated overlays are applied first, so subsequent explicit overlays can reference or further modify the RPC endpoints if needed.

### 2. Overlay Merge

The overlay resolver (`packages/contracts/src/overlay/overlay-resolver.js`) applies JSON Merge Patch-style actions from an overlay file to the base spec. Actions can:

- Add or replace fields at any path
- Remove fields with `null` values
- Add array items (using `x-merge` directives)

The overlay path is specified via the `--overlay` flag to `resolve.js`. It can be a single file or a directory. When given a directory, the resolver walks it recursively and discovers all `.yaml` files with `overlay: 1.0.0` at the top level, applying them in alphabetical order. Within this repository the convention is `packages/contracts/overlays/<state>/`; in a state repository the path is whatever the state's scripts pass to `--overlay`.

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

The resolved directory is consumed by:
- `generate-postman.js` to produce the Postman collection
- `npm run mock:start -- --spec=packages/resolved` to run the mock with overlay behavior

## Invoking the Pipeline

The pipeline is driven by `resolve.js`. These npm scripts cover common invocations:

| Script | What it does |
|--------|-------------|
| `npm run resolve` | Run the full pipeline and write resolved specs to `packages/resolved/` |
| `npm run postman:generate` | Run the full pipeline with the example overlay, then generate the Postman collection |

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
