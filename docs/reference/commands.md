# Command Reference

All available npm scripts in the Safety Net Blueprint toolkit.

## Quick Reference

| Command | Description |
|---------|-------------|
| `npm start` | Start mock server |
| `npm run mock:start:all` | Start mock server + Swagger UI |
| `npm run validate` | Validate resolved specs (all layers) |
| `npm run resolve` | Run the overlay resolve pipeline |
| `npm run mock:reset` | Reset database to example data |
| `npm test` | Run unit tests |
| `npm run test:integration` | Run integration tests (includes Postman/newman) |
| `npm run preflight` | Run all checks before creating a PR |

## Validation Commands

### `npm run validate`

Runs all validation layers against the resolved specs in `packages/generated/contracts/`:

- OpenAPI 3.x compliance and example validation
- Fragment `$ref` reference checks
- Annotation field path validation
- State machine cross-artifact consistency

```bash
npm run validate
```

Validation runs against resolved output. Run `npm run resolve` first if `packages/generated/contracts/` is missing or stale.

### `npm run validate:lint`

Runs Spectral linting against the resolved specs:

- Naming conventions (paths, operation IDs, schemas)
- HTTP method rules (POST → 201, DELETE → 204, GET → 404)
- Response structure

```bash
npm run validate:lint
```

### `npm run validate:patterns`

Validates API design patterns:

- Search parameters (`q`, `limit`, `offset`)
- Pagination response structure (`items`, `total`, `limit`, `offset`, `hasNext`)
- List response structure

```bash
npm run validate:patterns
```

## Overlay Commands

### `npm run resolve`

Runs the overlay pipeline against the base specs, producing resolved output in `packages/generated/contracts/`.

```bash
npm run resolve
```

Apply a state overlay:

```bash
npm run resolve -- --spec=packages/safety-net-contracts --overlay=path/to/state/overlay --out=packages/generated/contracts
```

See all flags:

```bash
npm run resolve -- --help
```

## Generation Commands

### `npm run api:new`

Scaffolds a new API spec in `packages/safety-net-contracts/src/domains/`.

```bash
npm run api:new -- --name "benefits" --resource "Benefit"
```

### `npm run clients:generate`

Generates TypeScript clients from the resolved specs into `packages/generated/clients/`.

```bash
npm run clients:generate
```

### `npm run postman:generate`

Generates the Postman collection from the resolved specs into `packages/generated/postman/`.

```bash
npm run postman:generate
```

## Server Commands

### `npm start`

Starts the mock server only.

```bash
npm start
```

Default: http://localhost:1080

### `npm run mock:start:all`

Starts both the mock server and Swagger UI.

```bash
npm run mock:start:all
```

- Mock server: http://localhost:1080
- Swagger UI: http://localhost:3000

### `npm run mock:start`

Starts only the mock server.

```bash
npm run mock:start
```

**Environment variables:**

| Variable | Description | Default |
|----------|-------------|---------|
| `MOCK_SERVER_HOST` | Host to bind | `localhost` |
| `MOCK_SERVER_PORT` | Port to use | `1080` |

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

Runs unit tests across all workspaces.

```bash
npm test
```

### `npm run test:integration`

Runs integration tests against the mock server. Automatically resolves specs and starts the server if needed.

```bash
npm run test:integration
```

Includes:
- CRUD operation tests for all discovered APIs
- Cross-API accessibility tests
- Postman collection execution via Newman

### `npm run test:all`

Runs unit, integration, and functional tests.

```bash
npm run test:all
```

### `npm run preflight`

Runs all checks in sequence — use before creating a PR:

1. Unit tests
2. Validate (all layers)
3. Resolve pipeline
4. Postman generation
5. Integration tests (including Postman/Newman)

```bash
npm run preflight
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MOCK_SERVER_HOST` | Mock server bind host | `localhost` |
| `MOCK_SERVER_PORT` | Mock server port | `1080` |
| `SKIP_VALIDATION` | Skip validation during generation | `false` |

## Chaining Commands

Common command combinations:

```bash
# Resolve then validate
npm run resolve && npm run validate

# Reset and start
npm run mock:reset && npm start

# Full pipeline: resolve, generate clients, run all tests
npm run resolve && npm run clients:generate && npm run test:all
```
