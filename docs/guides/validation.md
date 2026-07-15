# Validation Guide

## Quick Start

```bash
npm run validate              # Run all validations (base specs: syntax, lint, patterns)
npm run validate:syntax       # OpenAPI syntax and examples only
npm run validate:patterns     # API design patterns only
npm run validate:lint         # Redocly lint only
npm run validate:resolved     # Validate resolved output (run after npm run resolve)
```

For a description of all validation layers and the tools used, see [Contracts Build and Validation Pipeline](../architecture/contracts-pipeline.md).

## State-Specific Validation

When working with state overlays, resolve the overlay and validate the resolved output:

```bash
npm run resolve -- --spec=<spec-dir> --overlay=<overlay-dir> --out=<out-dir>
npm run validate:resolved
```

## Three Validation Layers

### 1. Syntax Validation (`validate:syntax`)

- Valid OpenAPI 3.x format
- All `$ref` references resolve
- Examples match their schemas

### 2. Lint (`validate:lint`)

Run from the schemas package: `npm run validate:lint -w @codeforamerica/safety-net-blueprint-contracts`

HTTP method rules:
- POST must return 201
- DELETE must return 204
- GET single resource must handle 404

Naming conventions:
- Paths: kebab-case (`/user-profiles`)
- Operation IDs: camelCase (`listPersons`)
- Schemas: PascalCase (`PersonCreate`)

### 3. Pattern Validation (`validate:patterns`)

List endpoints must have:
- `SearchQueryParam` or `q` parameter
- `LimitParam` or `limit` parameter
- `OffsetParam` or `offset` parameter
- Response with `items`, `total`, `limit`, `offset`

POST/PATCH must have request body.

---

## Common Errors

### Additional Properties

```
Error: homeAddress must NOT have additional property 'country'
```

**Fix:** Remove the property from example, or add it to schema.

### Missing Required Properties

```
Error: must have required property 'signature'
```

**Fix:** Add the missing field to your example.

### Type Mismatch

```
Error: price must be number
```

**Fix:** Use correct type (`99.99` not `"99.99"`).

---

## Customizing Rules

### Lint (`.redocly.yaml`)

```yaml
rules:
  info-contact: off              # Disable rule
  rule/post-must-return-201: warn  # Change severity
```

### Pattern Validation

Edit `scripts/validate-patterns.js` to modify custom rules.

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

```bash
npm run validate:state-machines           # Within-file consistency (no resolved specs needed)
npm run validate:state-machines-resolved  # Cross-artifact checks (requires resolved specs)
```

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
- String literals in CEL enum comparisons are valid values for the field (e.g. `"snap" in $application.programsAppliedFor`)
- `set: {field:}` steps target fields that exist on the machine object schema
- `call: {METHOD: path}` paths exist in the resolved spec

### Composition Validation

```bash
npm run validate:compositions             # bind: and fields: field references against schema
```

- `bind:` field names exist on the referenced resource schema (existing)
- `fields:` array entries exist on the referenced resource schema

### Annotation Validation

```bash
npm run validate:annotations              # Dot-notation field paths against schema
```

- Each `schema:` key (e.g. `application.programsAppliedFor[]`) resolves to a field that exists on the referenced resource schema

### SLA and Metrics Validation

```bash
npm run validate:sla-metrics              # var: field references in SLA types and metrics
```

- `var:` field names in SLA type `pauseWhen` conditions exist on the target resource schema
- `var:` field names in metric `filter` and `source.filter` expressions exist on the source resource schema

All cross-artifact validators run as part of `npm run validate:resolved` after overlay application.

---

## CI/CD

See [CI/CD for Backend](../integration/ci-cd-backend.md) for complete CI/CD examples.
