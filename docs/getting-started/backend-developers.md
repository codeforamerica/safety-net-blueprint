# Getting Started: Backend Developers

This guide is for developers who design API specifications, validate them, and build backend implementations that conform to the Safety Net API standards.

## What You'll Do

- Design and modify OpenAPI specifications
- Add state-specific variations via overlays
- Validate specs locally and in CI/CD
- Use the mock server to test your spec design
- Run contract tests against your backend implementation

## Prerequisites

- Node.js >= 18.0.0
- Git
- Familiarity with OpenAPI/Swagger

## Initial Setup

```bash
# Clone the repository
git clone https://github.com/codeforamerica/safety-net-openapi.git
cd safety-net-openapi

# Install dependencies
npm install

# Set your state (or add to your shell profile)
export STATE=<your-state>

# Verify installation
npm run validate:state
```

## Project Structure

```
openapi/
├── *.yaml                  # API specifications (persons, households, etc.)
├── components/             # Shared schemas, parameters, responses
├── examples/               # Example data for seeding the mock server
├── patterns/               # API design patterns and conventions
└── overlays/               # State-specific variations
    └── <state>/modifications.yaml
```

## Your First Workflow

### 1. Explore Existing Specs

Start the mock server and Swagger UI to see the current APIs:

```bash
npm start
```

- Swagger UI: http://localhost:3000 (browse and test APIs)
- Mock Server: http://localhost:1080 (API endpoints)

### 2. Validate Specifications

Before making changes, ensure everything validates:

```bash
# Validate base specs
npm run validate

# Validate your state's resolved specs
STATE=<your-state> npm run validate:state

# Validate all states
npm run validate:all-states
```

### 3. Make Changes to a Spec

Edit files in `openapi/` or `openapi/components/`. After changes:

```bash
# Validate your changes
npm run validate

# Reset the mock database to pick up example changes
npm run mock:reset

# Test with the mock server
npm start
```

### 4. Add State-Specific Variations

If your state needs different enum values, additional fields, or terminology changes, edit the overlay file:

```bash
# Edit your state's overlay
code openapi/overlays/<your-state>/modifications.yaml

# Validate the resolved spec
STATE=<your-state> npm run validate:state
```

See [State Overlays Guide](../guides/state-overlays.md) for overlay syntax.

### 5. Create a New API

Use the generator to scaffold a new API with all required patterns:

```bash
npm run api:new -- --name "benefits" --resource "Benefit"
```

This creates:
- `openapi/benefits.yaml` — API spec with CRUD endpoints
- `openapi/components/benefit.yaml` — Resource schema
- `openapi/examples/benefits.yaml` — Example data

See [Creating APIs Guide](../guides/creating-apis.md) for customization.

## Development Workflow

```bash
# 1. Make changes to specs or examples

# 2. Validate
npm run validate
STATE=<your-state> npm run validate:state

# 3. Test with mock server
npm run mock:reset
npm start

# 4. Commit
git add openapi/
git commit -m "Add new field to Person schema"
```

## CI/CD Integration

### Validating Specs in CI

```yaml
# .github/workflows/validate.yml
name: Validate Specs

on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install
      - run: npm run validate
      - run: npm run validate:all-states
```

### Contract Testing Your Backend

Once you've built a backend that implements the spec, use the generated Postman collection to verify conformance:

```yaml
# In your backend repository's CI
- name: Run contract tests
  run: |
    npx newman run path/to/postman-collection.json \
      --env-var "baseUrl=http://localhost:8080"
```

See [CI/CD for Backend](../integration/ci-cd-backend.md) for complete examples.

## Key Commands

| Command | When to Use |
|---------|-------------|
| `npm run validate` | After editing base specs |
| `npm run validate:state` | After editing overlays |
| `npm run validate:all-states` | Before committing, in CI |
| `npm run mock:reset` | After editing examples |
| `npm start` | To test specs interactively |
| `npm run api:new` | To create a new API |

## Next Steps

- [Creating APIs](../guides/creating-apis.md) — Detailed guide to designing specs
- [State Overlays](../guides/state-overlays.md) — How state variations work
- [Validation](../guides/validation.md) — Understanding validation rules
- [CI/CD for Backend](../integration/ci-cd-backend.md) — Contract testing setup
