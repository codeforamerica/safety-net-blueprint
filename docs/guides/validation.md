# Validation Guide

## Quick Start

```bash
npm run resolve               # Resolve base specs to packages/generated/contracts/
npm run validate              # Validate resolved specs (all layers)
npm run validate:lint         # Redocly lint only
npm run validate:patterns     # API design patterns only
```

For a description of all validation layers and the tools used, see [Contracts Build and Validation Pipeline](../architecture/contracts-pipeline.md).

## How Validation Works

Validation runs against the **resolved** output in `packages/generated/contracts/`, not the raw source specs. Raw specs use `base://` URI references (e.g. `base://components/parameters.yaml#/LimitParam`) that point to `blueprint-core/base-contracts/` — these can't be resolved pre-resolve. Always run `npm run resolve` before validating.

`npm run validate` runs four layers in sequence:

1. **OpenAPI** — valid OpenAPI 3.x format, all `$ref` references resolve, examples match their schemas
2. **Refs** — fragment references are valid (no dangling `#/components/...` pointers)
3. **Annotations** — dot-notation field paths in annotation files resolve to real schema properties
4. **State machines** — within-file consistency and cross-artifact checks (see below)

## State-Specific Validation

When working with state overlays, resolve the overlay first and validate the resolved output:

```bash
npm run resolve -- --spec=packages/safety-net-contracts --overlay=path/to/state/overlay --out=packages/generated/contracts
npm run validate
```

## Validation Layers

### Lint (`validate:lint`)

HTTP method rules:
- POST must return 201
- DELETE must return 204
- GET single resource must handle 404

Naming conventions:
- Paths: kebab-case (`/user-profiles`)
- Operation IDs: camelCase (`listPersons`)
- Schemas: PascalCase (`PersonCreate`)

### Pattern Validation (`validate:patterns`)

List endpoints must have:
- `SearchQueryParam` or `q` parameter
- `LimitParam` or `limit` parameter
- `OffsetParam` or `offset` parameter
- Response with `items`, `total`, `limit`, `offset`

POST/PATCH must have a request body.

---

## Common Errors

### Additional Properties

```
Error: homeAddress must NOT have additional property 'country'
```

**Fix:** Remove the property from the example, or add it to the schema.

### Missing Required Properties

```
Error: must have required property 'signature'
```

**Fix:** Add the missing field to your example.

### Type Mismatch

```
Error: price must be number
```

**Fix:** Use the correct type (`99.99` not `"99.99"`).

---

## Customizing Rules

### Lint (`.redocly.yaml`)

```yaml
rules:
  info-contact: off              # Disable rule
  rule/post-must-return-201: warn  # Change severity
```

### Pattern Validation

Edit `packages/blueprint-cli/scripts/validate/openapi.js` to modify custom rules.

---

## Automatic Validation

Validation runs automatically during:
- `npm run mock:setup`
- `npm run postman:generate`

Skip with `SKIP_VALIDATION=true`.

---

## Cross-Artifact Field Reference Validation

Several artifact types reference OpenAPI schema field names by string — renames that aren't reflected across all artifacts fail silently at runtime. These validators catch mismatches after overlays are applied. See [Cross-Artifact Impact of Field Renames](overlay-guide.md#cross-artifact-impact-of-field-renames) for a checklist.

### State Machine Validation

State machine validation runs as part of `npm run validate`. It performs:

**Within-file consistency:**
- Transition `from`/`to` states are declared in the machine's `states` list
- Guard condition IDs reference declared guards (in the file or its `extends:` chain)
- String-form `call:` IDs reference declared procedures or actions
- No duplicate state, action, procedure, or guard IDs
- `$params.field` references in procedures match declared `parameters:`
- Actor role values are valid `RoleType` enum values

**Cross-artifact checks** (run after `npm run resolve`):
- Machine `object:` names exist in the resolved spec
- Context `from:` paths resolve to known API endpoints
- `$variable.field` references in all string values exist on the bound schema
- String literals in CEL enum comparisons are valid values for the field
- `set: {field:}` steps target fields that exist on the machine object schema
- `call: {METHOD: path}` paths exist in the resolved spec

### Composition Validation

```bash
npm run validate:compositions
```

- `bind:` field names exist on the referenced resource schema
- `fields:` array entries exist on the referenced resource schema

### Annotation Validation

Runs as part of `npm run validate`. Each `schema:` key (e.g. `application.programsAppliedFor[]`) resolves to a field that exists on the referenced resource schema.

### SLA and Metrics Validation

```bash
npm run validate:sla-metrics
```

- `var:` field names in SLA type `pauseWhen` conditions exist on the target resource schema
- `var:` field names in metric `filter` and `source.filter` expressions exist on the source resource schema

---

## CI/CD

See [CI/CD for Backend](../guides/ci-cd-backend.md) for complete CI/CD examples.
