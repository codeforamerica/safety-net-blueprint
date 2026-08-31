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

These are the baseline conventions for base specs. The resolve pipeline can transform output per-state deployment — see [Overlay Guide: Global Config Options](./overlay-guide.md#global-config-options).

---

## Schema Organization

### Resource Schema Variant Pattern

Each resource is expressed as a family of schema variants, all composing from a single writable base that holds the domain properties clients can read and write:

| Variant | Purpose | What it adds |
|---|---|---|
| `{Resource}` | GET response body | System fields (`id`, `createdAt`, `updatedAt`), read-only computed fields |
| `{Resource}Create` | POST request body | Required field declarations |
| `{Resource}Update` | PATCH request body | `minProperties: 1` constraint |
| `{Resource}List` | GET collection response | Pagination envelope wrapping an array of `{Resource}` |

**`id`, `createdAt`, `updatedAt` belong in `{Resource}`, not in the writable base.** System fields are API mechanics, not domain knowledge. Keeping them out of the writable base means `{Resource}Create` and `{Resource}Update` can reference it directly without needing to strip readOnly fields.

### Where to define the writable base

**Default: `schemas/domain/{domain}.yaml`**

Put the writable base in a domain schema file. This is the preferred pattern because domain schema files are shared across multiple contract artifacts — OpenAPI specs, AsyncAPI specs, config schemas, and state machines all `$ref` into them. Putting domain types in the OpenAPI spec traps them there and forces duplication if another artifact ever needs the same type.

| Location | Purpose | Examples |
|---|---|---|
| `schemas/domain/{domain}.yaml` | Domain entity writable bases and sub-types | `Case`, `CaseMember`, `Appointment`, `Task` |
| `schemas/common/` or `components/common.yaml` | Value types reusable across any domain | `Address`, `Name`, `Email`, `PhoneNumber` |
| OpenAPI `components/schemas` | REST scaffolding only — composes API variants from the writable base | `{Resource}`, `{Resource}Create`, `{Resource}Update`, `{Resource}List`, enums used only by API parameters |

**Decision rule for common vs. domain:** A type belongs in `schemas/common/` only if it can be used verbatim in any domain without carrying domain-specific FK fields. If it needs domain-specific fields to be useful, it is a domain schema.

**When inline in the OpenAPI spec is acceptable:** Purely API-mechanical schemas that will never be referenced outside HTTP — pagination envelopes, error shapes, status enums used only as query parameters. These have no meaning outside the REST interface and don't belong in the shared domain layer.

**How the variants connect:**

```yaml
# schemas/domain/intake.yaml — domain fields only, no system fields
$schema: "https://json-schema.org/draft/2020-12/schema"
$id: "schemas/domain/intake.yaml"
$defs:
  Application:
    type: object
    properties:
      status: { type: string }
      programs: { type: array, items: { type: string } }
      # ... other domain fields

# intake-openapi.yaml components/schemas

Application:               # full resource — domain fields + system fields
  unevaluatedProperties: false
  required: [id, createdAt, updatedAt]
  allOf:
    - $ref: "./schemas/domain/intake.yaml#/$defs/Application"
    - type: object
      properties:
        id: { type: string, format: uuid, readOnly: true }
        createdAt: { type: string, format: date-time, readOnly: true }
        updatedAt: { type: string, format: date-time, readOnly: true }

ApplicationCreate:         # POST body — domain fields only, declare required
  allOf:
    - $ref: "./schemas/domain/intake.yaml#/$defs/Application"
    - type: object
      required: [status, programs]

ApplicationUpdate:         # PATCH body — domain fields only, at least one required
  allOf:
    - $ref: "./schemas/domain/intake.yaml#/$defs/Application"
    - type: object
      minProperties: 1

ApplicationList:           # GET collection response — pagination envelope (inline is fine)
  allOf:
    - $ref: "./components/pagination.yaml#/Pagination"
    - type: object
      required: [items]
      properties:
        items:
          type: array
          items:
            $ref: "#/components/schemas/Application"
```

### Immutable type fields

Some resources use a `type` field as their categorical identity — the type determines which fields are valid and how the record is processed by eligibility rules. Examples: income type (`wages`, `self_employed`), asset type (`vehicle`, `real_property`), expense type (`rent`, `medical`). For these resources, **`type` is immutable after creation**. Clients that need to change the type must delete and recreate the record.

The required placement differs by schema structure:

**Plain categorical schemas** (e.g. Deduction, Expense): do NOT put `type` in the base schema `required`. Put it in the Create schema's `allOf` required instead. The Update schema then inherits from the base and correctly does not require `type`.

```yaml
# Base — type is a property but not required
Deduction:
  required: [amount]          # type intentionally absent
  properties:
    type: { $ref: DeductionType }

# Create — type required here
DeductionCreate:
  allOf:
    - $ref: Deduction
    - required: [type, memberId]

# Update — type not required (PATCH can omit it)
DeductionUpdate:
  allOf:
    - $ref: Deduction
    - minProperties: 1
```

**Discriminated union schemas** (e.g. Income, Asset, Job, HealthPlan): the `oneOf`/discriminator at the root of the schema file enforces `type` for creates — no change needed to Create schemas. However, the Update schema must `$ref` the base sub-schema (e.g. `income.yaml#/$defs/IncomeBase`), not the discriminated root, so that PATCH bodies are not required to include `type`.

```yaml
# Update references the base, not the discriminated root
IncomeUpdate:
  allOf:
    - $ref: "./schemas/common/income.yaml#/$defs/IncomeBase"   # NOT income.yaml
    - minProperties: 1
```

See `conventions/resources.yaml` (`schema_patterns.immutable_type_pattern`) for the full pattern definition.

---

## Common Field Patterns

### Standard Resource Fields (Required)

Every resource must include `id` (uuid, readOnly), `createdAt` (date-time, readOnly), and `updatedAt` (date-time, readOnly). The generator scaffolds these automatically. See `docs/conventions/resources.yaml` (`schema_patterns.resource_base_fields`) for the canonical definitions and `components/common.yaml` for reusable schemas (Address, Name, Email, PhoneNumber).

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
- For sub-resource POSTs (`/resources/{id}/sub-resources`), the request schema **must** use `additionalProperties: true` (or omit the constraint entirely). The mock-server spreads URL path params into the body so denormalized parent FKs persist on the child record; a schema with `additionalProperties: false` would reject the auto-injected params. See `conventions/resources.yaml` → `sub_resource_paths` → `collection.collection_path.methods.POST` for the full rationale.

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

- **Pattern configuration**: `docs/conventions/`
- **Shared parameters**: `packages/contracts/components/parameters.yaml`
- **Shared responses**: `packages/contracts/components/responses.yaml`
- **Shared schemas**: `packages/contracts/components/common.yaml`
- [Validation Guide](./validation.md)
- [Search Patterns](search-patterns.md)
