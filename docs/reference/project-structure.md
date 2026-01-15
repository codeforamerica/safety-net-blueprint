# Project Structure

Overview of the repository layout and file conventions.

## Directory Layout

This project uses npm workspaces with three packages:

```
safety-net-openapi/
├── package.json                    # Root workspace config + command aliases
│
├── packages/
│   ├── schemas/                    # OpenAPI specs, validation, overlays
│   │   ├── package.json
│   │   ├── openapi/
│   │   │   ├── *.yaml              # Main API specs (persons.yaml, etc.)
│   │   │   ├── components/         # Shared schemas and parameters
│   │   │   │   ├── common.yaml     # Reusable schemas (Address, Name)
│   │   │   │   ├── common-parameters.yaml  # Query params (limit, offset)
│   │   │   │   ├── common-responses.yaml   # Error responses
│   │   │   │   └── {resource}.yaml # Resource-specific schemas
│   │   │   ├── examples/           # Example data for seeding
│   │   │   │   └── {resource}.yaml
│   │   │   ├── patterns/           # API design patterns
│   │   │   │   └── api-patterns.yaml
│   │   │   ├── overlays/           # State-specific variations
│   │   │   │   └── <state>/
│   │   │   │       └── modifications.yaml
│   │   │   └── resolved/           # Generated state specs (gitignored)
│   │   ├── src/
│   │   │   ├── overlay/            # Overlay resolution logic
│   │   │   └── validation/         # OpenAPI loader & validator
│   │   └── scripts/                # Validation & generation scripts
│   │
│   ├── mock-server/                # Development mock server
│   │   ├── package.json
│   │   ├── src/                    # Server implementation
│   │   │   ├── handlers/           # CRUD handlers
│   │   │   ├── database-manager.js
│   │   │   ├── seeder.js
│   │   │   └── ...
│   │   ├── scripts/                # Server startup scripts
│   │   │   ├── server.js
│   │   │   ├── setup.js
│   │   │   ├── reset.js
│   │   │   └── swagger/
│   │   └── tests/                  # Unit and integration tests
│   │       ├── unit/
│   │       └── integration/
│   │
│   └── clients/                    # API client generation
│       ├── package.json
│       ├── scripts/
│       │   └── build-state-package.js  # Main build script
│       ├── templates/
│       │   ├── package.template.json   # npm package template
│       │   └── search-helpers.ts       # Query builder utilities (q, search)
│       └── dist-packages/              # Output directory (gitignored)
│           └── {state}/                # State-specific packages
│
└── docs/                           # Documentation
    ├── getting-started/            # Persona-based onboarding
    ├── guides/                     # How-to guides
    ├── integration/                # CI/CD guides
    ├── reference/                  # Reference docs
    └── architecture-decisions/     # ADRs
```

## Workspaces

| Package | Purpose | Key Dependencies |
|---------|---------|------------------|
| `@safety-net/schemas` | OpenAPI specs, validation, overlay resolution | `js-yaml`, `ajv` |
| `@safety-net/mock-server` | Mock API server for development | `express`, `better-sqlite3` |
| `@safety-net/clients` | Generate TypeScript SDK packages | `@hey-api/openapi-ts`, `zod` |

### CI/CD Usage

Install only what you need:

```bash
# Client generation only
npm install -w @safety-net/schemas -w @safety-net/clients

# Mock server only
npm install -w @safety-net/schemas -w @safety-net/mock-server
```

## Naming Conventions

### Files

| Type | Convention | Example |
|------|------------|---------|
| API specs | kebab-case | `case-workers.yaml` |
| Component schemas | kebab-case | `case-worker.yaml` |
| Example files | kebab-case | `case-workers.yaml` |
| Overlay files | `{state}/modifications.yaml` | `<state>/modifications.yaml` |
| Scripts | kebab-case | `generate-clients.js` |
| Tests | kebab-case + `.test` | `overlay-resolver.test.js` |

### OpenAPI Elements

| Element | Convention | Example |
|---------|------------|---------|
| URL paths | kebab-case | `/case-workers` |
| Path parameters | camelCase | `{caseWorkerId}` |
| Query parameters | camelCase | `?sortOrder=desc` |
| Operation IDs | camelCase | `listCaseWorkers` |
| Schema names | PascalCase | `CaseWorker` |
| Property names | camelCase | `firstName` |

## Key Files

### Configuration

| File | Purpose |
|------|---------|
| `package.json` | Root workspace config and command aliases |
| `packages/*/package.json` | Package-specific dependencies and scripts |
| `packages/schemas/openapi/patterns/api-patterns.yaml` | API design pattern rules |

### Source of Truth

| File | Purpose |
|------|---------|
| `packages/schemas/openapi/*.yaml` | Main API specifications |
| `packages/schemas/openapi/components/*.yaml` | Reusable schemas |
| `packages/schemas/openapi/examples/*.yaml` | Example data |
| `packages/schemas/openapi/overlays/*/modifications.yaml` | State variations |

### Generated (Gitignored)

| File | Purpose | Regenerate |
|------|---------|------------|
| `packages/schemas/openapi/resolved/*.yaml` | State-resolved specs | `npm run overlay:resolve` |
| `packages/clients/dist-packages/{state}/` | State npm packages | `node packages/clients/scripts/build-state-package.js` |
| `packages/mock-server/data/*.db` | SQLite databases | `npm run mock:reset` |

## Adding New Resources

When adding a new API resource:

1. **API spec**: `packages/schemas/openapi/{resources}.yaml`
2. **Schema**: `packages/schemas/openapi/components/{resource}.yaml`
3. **Examples**: `packages/schemas/openapi/examples/{resources}.yaml`

Use the generator:

```bash
npm run api:new -- --name "benefits" --resource "Benefit"
```

## Adding State Overlays

1. Create overlay directory and file: `packages/schemas/openapi/overlays/{state}/modifications.yaml`
2. Define actions for state-specific changes
3. Validate: `STATE={state} npm run validate:state`

## Testing

| Directory | Purpose |
|-----------|---------|
| `packages/mock-server/tests/unit/` | Fast, isolated tests |
| `packages/mock-server/tests/integration/` | End-to-end API tests |

Run tests:

```bash
npm test              # Unit tests
npm run test:all      # All tests
```
