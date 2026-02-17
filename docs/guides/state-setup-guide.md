# State Setup Guide

> **Status: Draft**

This guide walks through adopting the Safety Net API base specs for a specific state implementation.

## What each package provides

| Package | Description | CLIs |
|---|---|---|
| `@codeforamerica/safety-net-blueprint-contracts` | Base OpenAPI specs, overlay resolver, validation | `safety-net-resolve`, `safety-net-design-reference` |
| `@codeforamerica/safety-net-blueprint-mock-server` | Mock API server and Swagger UI for development | `safety-net-mock`, `safety-net-swagger` |
| `@codeforamerica/safety-net-blueprint-clients` | Postman collection and TypeScript client generation | — |

States install these packages as dependencies and point the CLIs at their resolved specs.

## Initial setup

### 1. Create the state repository

```bash
mkdir my-state-apis
cd my-state-apis
npm init -y
```

### 2. Install dependencies

```bash
npm install @codeforamerica/safety-net-blueprint-contracts @codeforamerica/safety-net-blueprint-mock-server @codeforamerica/safety-net-blueprint-clients
```

### 3. Create directory structure

```
my-state-apis/
  overlays/           # State-specific overlay files
    modifications.yaml
  resolved/           # Generated output (gitignored)
  .env                # Environment-specific values (gitignored)
  package.json
```

Add `resolved/` and `.env` to `.gitignore`:

```
resolved/
.env
```

### 4. Add npm scripts

```json
{
  "scripts": {
    "resolve": "safety-net-resolve --base=./node_modules/@codeforamerica/safety-net-blueprint-contracts --overlays=./overlays --out=./resolved",
    "resolve:prod": "safety-net-resolve --base=./node_modules/@codeforamerica/safety-net-blueprint-contracts --overlays=./overlays --out=./resolved --env=production --env-file=.env",
    "validate": "node ./node_modules/@codeforamerica/safety-net-blueprint-contracts/scripts/validate-openapi.js --specs=./resolved --skip-examples",
    "mock:start": "safety-net-mock --specs=./resolved",
    "swagger": "safety-net-swagger --specs=./resolved",
    "build": "npm run resolve && npm run validate"
  }
}
```

### 5. Pin the base specs version

Use an exact version in `package.json` to control when you pick up base spec changes:

```json
{
  "dependencies": {
    "@codeforamerica/safety-net-blueprint-contracts": "1.2.0"
  }
}
```

## Overlay authoring

Overlays modify the base specs without forking them. Each overlay file uses the [OpenAPI Overlay Specification 1.0.0](https://github.com/OAI/Overlay-Specification) format.

A working example is included in the base repo at [`openapi/overlays/example/modifications.yaml`](../../packages/contracts/overlays/example/modifications.yaml). The patterns below reference that file — use it as a starting point for your own overlay.

### Overlay file structure

```yaml
overlay: 1.0.0
info:
  title: My State Overlay
  version: 1.0.0
  description: State-specific modifications to the base Safety Net API schemas.

actions:
  - target: <JSONPath expression>
    file: <filename>           # Optional: disambiguate when target matches multiple files
    description: <what this action does>
    update:
      <replacement value>
```

The `--overlays` directory is scanned recursively — any `.yaml` file starting with `overlay: 1.0.0` is discovered and applied. You can organize overlays into multiple files if preferred.

### JSONPath targets

Where a schema lives determines its JSONPath:

- **Schemas in API spec files** (e.g., `persons.yaml`, `users.yaml`): nested under `components/schemas`, so the target starts with `$.components.schemas.`
- **Schemas in shared component files** (e.g., `components/common.yaml`, `components/auth.yaml`): top-level in the file, so the target starts with `$.`

### File disambiguation

When a schema name appears in multiple files, use `file:` to specify which file the action targets. Without it, the resolver warns and skips ambiguous matches.

```yaml
# Program exists in components/common.yaml — use file: to be explicit
- target: $.Program.enum
  file: components/common.yaml
  description: Replace program names
  update:
    - snap_state
    - tanf_state
```

### Common patterns

**Replace enum values** — change terminology to match state conventions:

```yaml
# From the example overlay: replace citizenship status terminology
- target: $.components.schemas.CitizenshipInfo.properties.status.enum
  file: persons.yaml
  description: Replace citizenship status values with state-specific terminology
  update:
    - us_citizen
    - lawful_permanent_resident
    - qualified_alien
    - prucol
    - undocumented
    - other
```

**Add properties** — extend schemas with state-required fields:

```yaml
# From the example overlay: add geographic tracking to Person
- target: $.components.schemas.Person.allOf.1.properties
  file: persons.yaml
  description: Add state-specific geographic tracking fields
  update:
    regionCode:
      type: string
      description: State region or county code for benefit administration.
      example: "042"
    regionName:
      type: string
      description: State region or county name.
      example: "Example County"
```

**Replace a flexible schema** — define explicit properties for schemas that use `additionalProperties: true`:

```yaml
# From the example overlay: define UiPermissions structure
- target: $.components.schemas.UiPermissions
  file: users.yaml
  description: Add explicit property definitions to UiPermissions
  update:
    type: object
    readOnly: true
    additionalProperties: true
    description: State-specific UI permissions.
    properties:
      availableModules:
        type: array
        items:
          type: string
          enum: [cases, tasks, reports, documents, admin, state_integration]
      canApproveApplications:
        type: boolean
```

**Extend auth context** — add claims for state-specific authorization:

```yaml
# From the example overlay: add program-based auth
- target: $.BackendAuthContext.properties
  file: components/auth.yaml
  description: Add program-based authorization to auth context
  update:
    programs:
      type: array
      items:
        type: string
      description: Programs the user is authorized to access.
```

### Version and API disambiguation

When multiple API versions exist (e.g., `applications.yaml` and `applications-v2.yaml`), use these optional properties to target a specific version or API:

```yaml
- target: $.components.schemas.Person.allOf.1.properties
  target-version: 2          # Only apply to v2 specs
  description: Add field only to v2

- target: $.components.schemas.Application
  target-api: applications   # Match spec with info.x-api-id: applications
  description: Target a specific API
```

## Working with shared types

Shared types (Address, Name, etc.) live in `components/*.yaml` and are referenced by multiple API specs via `$ref`. There are two approaches to customizing them:

### Approach 1: Modify the shared type via overlay

Changes propagate to all specs that reference the type.

```yaml
# Add a state-specific field to Address — affects all APIs
- target: $.Address.properties
  file: components/contact.yaml
  description: Add apartment/unit field to Address
  update:
    unit:
      type: string
      description: Apartment or unit number.
```

### Approach 2: Replace a $ref with an inline schema

Decouple from the shared type entirely. Use `replace` to swap a `$ref` with a state-specific inline schema.

```yaml
# Replace the shared Address ref in Person with a state-specific schema
- target: $.components.schemas.Person.allOf.0.properties.address
  file: persons.yaml
  description: Use state-specific address format
  update:
    type: object
    properties:
      street1:
        type: string
      street2:
        type: string
      city:
        type: string
      state:
        type: string
        enum: [CA]
      zipCode:
        type: string
        pattern: "^[0-9]{5}(-[0-9]{4})?$"
```

Note: the `components/` folder is preserved in resolved output — this is expected and harmless. Downstream tools consume the resolved API spec files, not the component files directly.

## Environment configuration

### x-environments filtering

Tag spec sections with `x-environments` to include them only in specific environments:

```yaml
# In your overlay or resolved spec
paths:
  /debug/health:
    x-environments: [development, staging]
    get:
      summary: Health check (non-production only)
```

Resolve with `--env` to filter:

```bash
# Production: /debug/health is removed
safety-net-resolve --base=... --overlays=... --out=./resolved --env=production

# Development: /debug/health is kept, x-environments is stripped
safety-net-resolve --base=... --overlays=... --out=./resolved --env=development
```

Without `--env`, all sections are included as-is.

### Placeholder substitution

Use `${VAR}` placeholders in string values for environment-specific configuration:

```yaml
servers:
  - url: ${API_BASE_URL}
    description: API server
```

Provide values via `.env` file and/or environment variables:

```bash
# .env file
API_BASE_URL=https://api.example.gov
AUTH_ISSUER=https://auth.example.gov

# Resolve with substitution
safety-net-resolve --base=... --overlays=... --out=./resolved --env-file=.env
```

Environment variables (`process.env`) take precedence over `.env` file values. This lets CI set overrides without modifying the file:

```bash
API_BASE_URL=https://api-staging.example.gov safety-net-resolve --base=... --out=./resolved --env-file=.env
```

Unresolved placeholders produce warnings but don't fail the build.

## CI pipeline

A typical CI pipeline resolves overlays, validates, and generates artifacts:

```yaml
# Example GitHub Actions workflow
name: Build and Validate

on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci

      # Resolve overlays with production environment
      - name: Resolve specs
        run: npm run resolve:prod
        env:
          API_BASE_URL: ${{ vars.API_BASE_URL }}

      # Validate resolved specs
      - name: Validate
        run: npm run validate

      # Start mock server and run tests
      - name: Integration tests
        run: |
          npm run mock:start &
          sleep 3
          npm test
```

### Processing order

The resolver applies transformations in this order:

1. Copy base specs to output directory
2. Apply overlay actions
3. Filter by `x-environments` (if `--env` provided)
4. Substitute `${VAR}` placeholders (if `--env-file` provided or env vars exist)

## Updating base specs

When a new version of `@codeforamerica/safety-net-blueprint-contracts` is released:

1. **Review the changelog** for breaking changes to schemas or file structure
2. **Update the dependency**: `npm install @codeforamerica/safety-net-blueprint-contracts@<new-version>`
3. **Run resolve**: `npm run resolve` — overlay actions that target paths that no longer exist will produce warnings
4. **Fix stale overlay targets**: update JSONPath expressions to match the new schema structure
5. **Validate**: `npm run validate` — confirm the resolved output is valid
6. **Run tests**: verify your integration tests still pass

Pinning to exact versions (not ranges) gives you control over when to adopt changes.

## Security considerations

- **Keep `.env` out of version control** — add it to `.gitignore`
- **Keep `resolved/` out of version control** — it's generated output and may contain substituted secrets
- **Use CI environment variables** for production secrets (API keys, auth issuer URLs) rather than committing them to `.env` files
- **Review overlay changes** — overlays can modify auth schemas, security schemes, and server URLs. Treat overlay changes with the same scrutiny as code changes.

## Contributing back

Some state customizations may benefit all states. Consider proposing changes to the base specs when:

- A field is universally needed but missing from the base schema
- A pattern you've implemented via overlay would be cleaner as a base schema change
- You've identified a bug or inconsistency in the base specs

To contribute:

1. Open an issue describing the proposed change and why it benefits multiple states
2. If approved, submit a PR against the base `@codeforamerica/safety-net-blueprint-contracts` repo
3. Once merged, remove the corresponding overlay action — the change is now in the base
