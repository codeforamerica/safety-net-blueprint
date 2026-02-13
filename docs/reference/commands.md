# Command Reference

> **Status: Draft**

All available npm scripts in the Safety Net APIs toolkit.

## Quick Reference

| Command | Description |
|---------|-------------|
| `npm start` | Start mock server + Swagger UI |
| `npm run validate` | Validate base specs |
| `npm run mock:start` | Start mock server only |
| `npm run mock:reset` | Reset database to example data |
| `npm test` | Run unit tests |
| `npm run test:integration` | Run integration tests (includes Postman/newman) |

## Validation Commands

### `npm run validate`

Runs all validation layers against base specs:
- Syntax validation (OpenAPI 3.x compliance)
- Spectral linting (naming conventions, HTTP methods)
- Pattern validation (search, pagination, CRUD)

```bash
npm run validate
```

### `npm run validate:syntax`

Validates OpenAPI syntax only:
- Valid OpenAPI 3.x format
- All `$ref` references resolve
- Examples match their schemas

```bash
npm run validate:syntax
```

### `npm run validate:lint -w @safety-net/schemas`

Runs Spectral linting only (available in the schemas package):
- Naming conventions
- HTTP method rules
- Response codes

```bash
npm run validate:lint -w @safety-net/schemas
```

### `npm run validate:patterns`

Validates API design patterns only:
- Search parameters
- Pagination
- List response structure

```bash
npm run validate:patterns
```

## Overlay Commands

### `npm run overlay:resolve`

Resolves the overlay for the current STATE, writing to `openapi/resolved/`.

Without STATE set, lists available states:
```bash
npm run overlay:resolve
# Output: Available states: <lists all configured states>
```

With STATE set:
```bash
STATE=<your-state> npm run overlay:resolve
```

## Generation Commands

### `npm run api:new`

Generates a new API from the template.

```bash
npm run api:new -- --name "benefits" --resource "Benefit"
```

Creates:
- `openapi/benefits.yaml`
- `openapi/components/benefit.yaml`
- `openapi/examples/benefits.yaml`

### Building State Packages

Build a state-specific npm package with TypeScript SDK and Zod schemas:

```bash
node packages/clients/scripts/build-state-package.js --state=<your-state> --version=1.0.0
```

This generates a complete npm package in `packages/clients/dist-packages/{state}/` containing:
- Typed SDK functions (`getPerson`, `createPerson`, etc.)
- TypeScript interfaces
- Zod schemas for runtime validation
- Axios-based HTTP client

The package is built using `@hey-api/openapi-ts` with the following plugins:
- `@hey-api/typescript` - TypeScript types
- `@hey-api/sdk` - SDK functions with validation
- `@hey-api/zod` - Zod schemas
- `@hey-api/client-axios` - Axios HTTP client

## Server Commands

### `npm start`

Starts both the mock server and Swagger UI.

```bash
STATE=<your-state> npm start
```

- Mock server: http://localhost:1080
- Swagger UI: http://localhost:3000

### `npm run mock:start`

Starts only the mock server.

```bash
STATE=<your-state> npm run mock:start
```

Default: http://localhost:1080

**Environment variables:**
- `MOCK_SERVER_HOST` - Host to bind (default: `localhost`)
- `MOCK_SERVER_PORT` - Port to use (default: `1080`)

```bash
MOCK_SERVER_HOST=0.0.0.0 MOCK_SERVER_PORT=8080 npm run mock:start
```

### `npm run mock:setup`

Initializes databases without starting the server.

```bash
npm run mock:setup
```

### `npm run mock:reset`

Clears all data and reseeds from examples.

```bash
npm run mock:reset
```

### `npm run mock:swagger`

Starts only the Swagger UI server.

```bash
npm run mock:swagger
```

Default: http://localhost:3000

## Test Commands

### `npm test`

Runs unit tests.

```bash
npm test
```

### `npm run test:unit`

Alias for `npm test`.

### `npm run test:integration`

Runs integration tests against the mock server. Automatically starts the server if not running.

```bash
npm run test:integration
```

Includes:
- CRUD operation tests for all discovered APIs
- Cross-API accessibility tests
- Postman collection execution via Newman

### `npm run test:all`

Runs both unit and integration tests.

```bash
npm run test:all
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `STATE` | Active state for overlays | (none) |
| `MOCK_SERVER_HOST` | Mock server bind host | `localhost` |
| `MOCK_SERVER_PORT` | Mock server port | `1080` |
| `SKIP_VALIDATION` | Skip validation during generation | `false` |

## Chaining Commands

Common command combinations:

```bash
# Full validation
npm run validate

# Reset and start
npm run mock:reset && npm start

# Build state package (resolve overlay + generate + compile)
STATE=<your-state> npm run overlay:resolve && node packages/clients/scripts/build-state-package.js --state=<your-state> --version=1.0.0

# Full test suite
npm run validate && npm test && npm run test:integration
```
