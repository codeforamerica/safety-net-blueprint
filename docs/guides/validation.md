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

## Behavioral Contract Validation (planned)

The prototypes will extend validation to check cross-artifact consistency:

- State machine states match OpenAPI status enums
- Effect targets reference schemas that exist
- Rule context variables resolve to real fields
- Field metadata source paths resolve to OpenAPI schema fields
- Transitions include required audit effects
- Metric sources reference states/transitions that exist

See [Backend Developer Guide — Validate](../getting-started/backend-developers.md#3-validate) for the target validation workflow.

---

## CI/CD

See [CI/CD for Backend](../integration/ci-cd-backend.md) for complete CI/CD examples.
