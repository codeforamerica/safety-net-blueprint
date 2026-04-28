# Creating New APIs

> **Status: Draft**

This guide provides instructions for creating new REST APIs that follow our established patterns. Use it to generate consistent, validated API specifications.

## Quick Start

Each domain has one OpenAPI spec (e.g., `intake-openapi.yaml`). Most work involves adding resources to an existing domain spec.

### Add a resource to an existing domain spec

```bash
npm run api:update -- --name "intake" --resource "Household"
```

This merges new paths, schemas, parameters, a tag, and an example into the existing spec.

### Create a spec for a new domain

Use `api:new` only when the domain doesn't have a spec yet:

```bash
npm run api:new -- --name "intake" --resource "Application"
```

If the spec name differs from its domain (uncommon), pass `--domain` explicitly:

```bash
npm run api:new -- --name "households" --domain "intake" --resource "Household"
```

This generates `{name}-openapi.yaml` with full CRUD paths, schemas, an inline example, and all required `info` fields (`x-domain`, `x-status`, `x-visibility`).

---

## Manual Creation Guide

If you need more control or are building a complex API, follow these steps.

### Step 1: Understand the File Structure

Specs can live anywhere — the tooling takes a `--spec` argument pointing to any directory. The default is `packages/contracts/`. The `{domain}-openapi.yaml` naming pattern is what matters: validators and the resolve pipeline auto-discover files matching that suffix.

```
{your-spec-dir}/
├── {domain}-openapi.yaml           # Main API specification
└── components/
    ├── common.yaml                 # Shared schemas (Address, Name, etc.)
    ├── parameters.yaml             # Shared query parameters
    ├── responses.yaml              # Shared error responses
    └── {resource}.yaml             # Resource-specific shared schemas
```

### Step 2: Create the API Specification

Create `{domain}-openapi.yaml` in your spec directory. Use the output of `api:new` as your starting point, then customize the schemas.

> **x- extensions:** The `info` block requires `x-domain`, `x-status`, and `x-visibility`. Top-level `x-events` declares domain events. `x-relationship` annotates FK fields. See the [x-extensions reference](../architecture/x-extensions.md) for the full catalog.

### Step 3: Validate

Run all validation layers:

```bash
npm run validate
```

This runs:
1. **Syntax validation** - OpenAPI 3.1 compliance, $ref resolution, example validation
2. **Lint validation** - Naming conventions, response codes, content types
3. **Pattern validation** - Search params, pagination, list response structure

---

## Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| File names | kebab-case | `case-workers.yaml` |
| URL paths | kebab-case | `/case-workers` |
| Path parameters | camelCase | `{caseWorkerId}` |
| Query parameters | camelCase | `?sortOrder=desc` |
| Operation IDs | camelCase | `listCaseWorkers` |
| Schema names | PascalCase | `CaseWorker` |
| Property names | camelCase | `firstName` |

These are the baseline conventions for base specs. The resolve pipeline can transform output per-state deployment — see [State Overlays: Global Config Options](./state-overlays.md#global-config-options).

---

## Common Field Patterns

### Standard Resource Fields (Required)

Every resource must include `id` (uuid, readOnly), `createdAt` (date-time, readOnly), and `updatedAt` (date-time, readOnly). The generator scaffolds these automatically. See `packages/contracts/patterns/api-patterns.yaml#schema_patterns.resource_base_fields` for the canonical definitions and `components/common.yaml` for reusable schemas (Address, Name, Email, PhoneNumber).

---

## Validation Rules Enforced

### Required for List Endpoints
- Must have `SearchQueryParam` (or `q` parameter)
- Must have `LimitParam` (or `limit` parameter)
- Must have `OffsetParam` (or `offset` parameter)
- Response must have `items`, `total`, `limit`, `offset` properties
- `items` must be an array

### Required for POST Endpoints
- Must return 201 Created
- Should have Location header
- Must have request body

### Required for PATCH Endpoints
- Must return 200 OK
- Must have request body

### Required for Single Resource GET
- Must handle 404 Not Found

### Error Responses
- Should use shared `$ref` for 400, 404, 422, 500 responses

---

## Checklist

Before submitting a new API:

- [ ] Main spec named `{domain}-openapi.yaml` in your spec directory
- [ ] All required fields have `id`, `createdAt`, `updatedAt`
- [ ] List endpoint has search and pagination parameters
- [ ] List response has `items`, `total`, `limit`, `offset`, `hasNext`
- [ ] POST returns 201 with Location header
- [ ] PATCH returns 200
- [ ] DELETE returns 204
- [ ] Single-resource GET handles 404
- [ ] Error responses use shared `$ref`
- [ ] `npm run validate` passes with no errors

---

## Reference

- **Pattern configuration**: `packages/contracts/patterns/api-patterns.yaml`
- **Shared parameters**: `packages/contracts/components/parameters.yaml`
- **Shared responses**: `packages/contracts/components/responses.yaml`
- **Shared schemas**: `packages/contracts/components/common.yaml`
- [Validation Guide](./validation.md)
- [Search Patterns](../decisions/search-patterns.md)
