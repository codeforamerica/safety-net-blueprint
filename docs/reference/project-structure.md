# Project Structure

> **Status: Draft**

Overview of the repository layout and file conventions.

## Directory Layout

This project uses npm workspaces with three packages:

```
safety-net-blueprint/
├── package.json                    # Root workspace config + command aliases
│
├── packages/
│   ├── contracts/                  # Behavioral contracts, OpenAPI specs, validation, overlays
│   │   ├── package.json
│   │   ├── *-openapi.yaml          # Main API specs (persons-openapi.yaml, etc.)
│   │   ├── *-openapi-examples.yaml # Example data for seeding
│   │   ├── components/             # Shared schemas and parameters
│   │   │   ├── common.yaml         # Reusable schemas (Address, Name)
│   │   │   ├── parameters.yaml     # Query params (limit, offset)
│   │   │   ├── responses.yaml      # Error responses
│   │   │   └── {resource}.yaml     # Resource-specific shared schemas
│   │   ├── patterns/               # API design patterns
│   │   │   └── api-patterns.yaml
│   │   ├── overlays/               # State-specific variations
│   │   │   └── <state>/
│   │   │       └── modifications.yaml
│   │   ├── authored/               # Source tables for generated contracts (CSV)
│   │   ├── examples/               # Runnable examples (prototypes)
│   │   ├── resolved/               # Generated state specs (gitignored)
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
    ├── architecture/               # Architecture docs
    ├── decisions/                  # Architectural decision records
    ├── getting-started/            # Persona-based onboarding
    ├── guides/                     # How-to guides
    ├── integration/                # CI/CD guides
    ├── presentation/               # Executive summary and slide deck
    ├── prototypes/                 # Implementation specs (steel threads)
    └── reference/                  # Reference docs
```

## Workspaces

| Package | Purpose | Key Dependencies |
|---------|---------|------------------|
| `@safety-net/contracts` | OpenAPI specs, validation, overlay resolution | `js-yaml`, `ajv` |
| `@safety-net/mock-server` | Mock API server for development | `express`, `better-sqlite3` |
| `@safety-net/clients` | Generate TypeScript SDK packages | `@hey-api/openapi-ts`, `zod` |

### CI/CD Usage

Install only what you need:

```bash
# Client generation only
npm install -w @safety-net/contracts -w @safety-net/clients

# Mock server only
npm install -w @safety-net/contracts -w @safety-net/mock-server
```

## Naming Conventions

### Files

| Type | Convention | Example |
|------|------------|---------|
| API specs | `{domain}-openapi.yaml` | `case-workers-openapi.yaml` |
| Example files | `{domain}-openapi-examples.yaml` | `case-workers-openapi-examples.yaml` |
| Component schemas | kebab-case in `components/` | `components/common.yaml` |
| Overlay files | `overlays/{state}/modifications.yaml` | `overlays/california/modifications.yaml` |
| Scripts | kebab-case | `generate-clients-typescript.js` |
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
| `packages/contracts/patterns/api-patterns.yaml` | API design pattern rules |

### Source of Truth

| File | Purpose |
|------|---------|
| `packages/contracts/*-openapi.yaml` | Main API specifications |
| `packages/contracts/*-openapi-examples.yaml` | Example data |
| `packages/contracts/components/*.yaml` | Shared schemas and parameters |
| `packages/contracts/overlays/*/modifications.yaml` | State variations |

### Generated (Gitignored)

| File | Purpose | Regenerate |
|------|---------|------------|
| `packages/contracts/resolved/*.yaml` | State-resolved specs | `npm run overlay:resolve` |
| `packages/clients/dist-packages/{state}/` | State npm packages | `node packages/clients/scripts/build-state-package.js` |
| `packages/mock-server/data/*.db` | SQLite databases | `npm run mock:reset` |

## Adding New Resources

When adding a new API resource:

1. **API spec**: `packages/contracts/{resources}-openapi.yaml` (schemas inline)
2. **Examples**: `packages/contracts/{resources}-openapi-examples.yaml`

Use the generator:

```bash
npm run api:new -- --name "benefits" --resource "Benefit"
```

## Adding State Overlays

1. Create overlay directory and file: `packages/contracts/overlays/{state}/modifications.yaml`
2. Define actions for state-specific changes
3. Validate: `STATE={state} npm run overlay:resolve`

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
