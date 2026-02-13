# Validation Guide

> **Status: Draft**

> **Note:** OpenAPI validation (syntax, linting, and pattern checks) works today. Behavioral contract validation — cross-artifact consistency checks for state machines, rules, metrics, and form definitions — is being built as part of the [steel thread prototypes](../prototypes/workflow-prototype.md).

## Quick Start

```bash
npm run validate              # Run all validations (base specs)
npm run validate:syntax       # OpenAPI syntax and examples only
npm run validate:patterns     # API design patterns only
```

## State-Specific Validation

When working with state overlays, resolve the overlay and check for target warnings:

```bash
STATE=<your-state> npm run overlay:resolve
```

The resolver warns about invalid targets (e.g., paths that don't exist in the base schema). After resolving, validate the base specs to ensure no regressions:

```bash
npm run validate
```

## Three Validation Layers

### 1. Syntax Validation (`validate:syntax`)

- Valid OpenAPI 3.x format
- All `$ref` references resolve
- Examples match their schemas

### 2. Spectral Linting

Run from the schemas package: `npm run validate:lint -w @safety-net/schemas`

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

### Spectral (`.spectral.yaml`)

```yaml
rules:
  info-contact: off              # Disable rule
  post-must-return-201: warn     # Change severity
```

### Pattern Validation

Edit `scripts/validate-patterns.js` to modify custom rules.

---

## Automatic Validation

Validation runs automatically during:
- `npm run mock:setup`
- `npm run clients:generate`
- `npm run postman:generate`

Skip with `SKIP_VALIDATION=true`.

---

## Behavioral Contract Validation (planned)

The prototypes will extend validation to check cross-artifact consistency:

- State machine states match OpenAPI status enums
- Effect targets reference schemas that exist
- Rule context variables resolve to real fields
- Form definition field source paths resolve to OpenAPI schema fields
- Transitions include required audit effects
- Metric sources reference states/transitions that exist

See [Backend Developer Guide — Validate](../getting-started/backend-developers.md#3-validate) for the target validation workflow.

---

## CI/CD

See [CI/CD for Backend](../integration/ci-cd-backend.md) for complete CI/CD examples.
