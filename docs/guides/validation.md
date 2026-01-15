# Validation Guide

## Quick Start

```bash
npm run validate              # Run all validations (base specs)
npm run validate:syntax       # OpenAPI syntax and examples only
npm run validate:lint         # Spectral linting only
npm run validate:patterns     # API design patterns only
```

## State-Specific Validation

When working with state overlays, use these commands to validate resolved specs:

```bash
STATE=<your-state> npm run validate:state   # Resolve + validate one state
npm run validate:state -- --state=<your-state>
npm run validate:all-states                 # Resolve + validate all states
```

This runs the overlay resolution first (reporting any invalid targets), then validates the resolved specs.

## Three Validation Layers

### 1. Syntax Validation (`validate:syntax`)

- Valid OpenAPI 3.x format
- All `$ref` references resolve
- Examples match their schemas

### 2. Spectral Linting (`validate:lint`)

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

## CI/CD

See [CI/CD for Backend](../integration/ci-cd-backend.md) for complete CI/CD examples.
