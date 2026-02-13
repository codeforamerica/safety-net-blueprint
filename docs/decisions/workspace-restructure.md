# ADR: NPM Workspaces for Package Separation

**Status:** Accepted

**Date:** 2025-12-18

**Deciders:** Development Team

> **Note:** Implementation details below (scripts, dependencies, generated output structure) reflect the state at decision time. The workspace structure and package boundaries are unchanged, but tooling has evolved — notably the client generator migrated from Zodios to @hey-api/openapi-ts (see [openapi-ts-client-generation](openapi-ts-client-generation.md)) and the Node.js minimum is now 20.19.0+. See `package.json` files for current details.

---

## Context

The Safety Net OpenAPI toolkit contains several distinct capabilities:

- **Schema management** — OpenAPI specs, validation, overlay resolution
- **Mock server** — Express-based server for development/testing
- **Client generation** — TypeScript clients, Postman collections

Currently, all code lives in a single package with all dependencies installed together. This creates issues for CI/CD pipelines that only need a subset of functionality (e.g., generating clients without mock server dependencies).

### Requirements

- Enable CI/CD to install only necessary dependencies for specific tasks
- Maintain simple developer experience for local development
- Clear separation of concerns between different capabilities
- Preserve existing command-line interface where possible

### Constraints

- Must work with existing Node.js 18+ requirement
- Should not require significant changes to daily developer workflow
- Need to support cross-package imports (e.g., clients need schema utilities)

---

## Decision

Restructure the project into **npm workspaces** with three packages:

```
safety-net-apis/
├── package.json                    # Root workspace config + aliases
├── packages/
│   ├── schemas/                    # OpenAPI specs, validation, overlays
│   │   ├── package.json
│   │   ├── openapi/
│   │   │   ├── *.yaml              # API specifications
│   │   │   ├── components/         # Shared schemas
│   │   │   ├── examples/           # Example data
│   │   │   ├── patterns/           # API pattern definitions
│   │   │   └── overlays/           # State overlays
│   │   ├── src/
│   │   │   └── overlay/            # Overlay resolver
│   │   └── scripts/
│   │       ├── validate-openapi.js
│   │       ├── validate-patterns.js
│   │       ├── validate-state.js
│   │       ├── resolve-overlay.js
│   │       └── generate-api.js
│   │
│   ├── mock-server/                # Development mock server
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── handlers/
│   │   │   ├── database-manager.js
│   │   │   ├── route-generator.js
│   │   │   └── ...
│   │   └── scripts/
│   │       ├── server.js
│   │       ├── setup.js
│   │       └── reset.js
│   │
│   └── clients/                    # Generated API clients
│       ├── package.json
│       ├── generated/
│       │   ├── zodios/
│       │   └── postman-collection.json
│       └── scripts/
│           ├── generate-zodios.js
│           └── generate-postman.js
```

### Package Dependencies

```
┌──────────────┐
│   schemas    │  ← No internal dependencies
└──────────────┘
       ▲
       │ depends on
┌──────┴───────┐     ┌──────────────┐
│ mock-server  │     │   clients    │  ← Both depend on schemas
└──────────────┘     └──────────────┘
```

### Package Responsibilities

| Package | Purpose | Key Dependencies |
|---------|---------|------------------|
| `@safety-net/schemas` | OpenAPI specs, validation, overlay resolution | `js-yaml`, `ajv`, `@stoplight/spectral-cli` |
| `@safety-net/mock-server` | Mock API server for development | `express`, `better-sqlite3`, `cors` |
| `@safety-net/clients` | Generate TypeScript clients, Postman collections | `openapi-zod-client` |

---

## Options Considered

### Option 1: Single Package (Current)

Keep everything in one `package.json`.

| Pros | Cons |
|------|------|
| Simple structure | CI installs unnecessary deps |
| No cross-package imports | Unclear code ownership |
| Familiar to all developers | Can't version separately |

**Rejected because:** CI/CD optimization is a stated requirement. Dependency bloat will grow as more generators are added.

---

### Option 2: Optional Dependencies

Use `optionalDependencies` to mark non-essential packages.

```json
{
  "optionalDependencies": {
    "express": "^5.1.0",
    "openapi-zod-client": "^1.18.2"
  }
}
```

| Pros | Cons |
|------|------|
| Minimal structural change | Not granular enough |
| Single package.json | Optional deps still downloaded by default |
| | Confusing developer experience |

**Rejected because:** Doesn't provide clear separation. CI would need custom logic to install specific optionals.

---

### Option 3: NPM Workspaces (CHOSEN)

| Pros | Cons |
|------|------|
| Standard npm feature | Learning curve for workspaces |
| Granular CI installs | Cross-package imports need setup |
| Clear code ownership | More files to maintain |
| Independent versioning possible | |

**Accepted because:** Best balance of CI optimization and developer experience. Root aliases preserve familiar commands.

---

### Option 4: Separate Repositories

Split into 3 distinct repositories.

| Pros | Cons |
|------|------|
| Complete isolation | Coordination overhead |
| Independent release cycles | Harder to keep in sync |
| | Schema changes require multi-repo PRs |

**Rejected because:** Overkill for current project size. Coordination cost outweighs benefits.

---

## Implementation

### Root package.json

```json
{
  "name": "safety-net-apis",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "validate": "npm run validate -w @safety-net/schemas",
    "validate:state": "npm run validate:state -w @safety-net/schemas",
    "start": "npm start -w @safety-net/mock-server",
    "mock:start": "npm run start -w @safety-net/mock-server",
    "mock:setup": "npm run setup -w @safety-net/mock-server",
    "clients:generate": "npm run generate -w @safety-net/clients",
    "postman:generate": "npm run postman -w @safety-net/clients",
    "test": "npm test --workspaces --if-present"
  }
}
```

### CI/CD Usage

```yaml
# Install only what's needed for client generation
- run: npm install -w @safety-net/schemas -w @safety-net/clients
- run: npm run generate -w @safety-net/clients

# Install only mock server
- run: npm install -w @safety-net/schemas -w @safety-net/mock-server
- run: npm start -w @safety-net/mock-server
```

### Cross-Package Imports

```js
// packages/mock-server/src/openapi-loader.js
import { applyOverlay } from '@safety-net/schemas';
```

Workspace packages reference each other in `package.json`:

```json
// packages/mock-server/package.json
{
  "dependencies": {
    "@safety-net/schemas": "*"
  }
}
```

---

## Consequences

### Positive

- CI/CD can install minimal dependencies for specific tasks
- Clear ownership: schemas vs mock-server vs clients
- Independent testing per package
- Future: can publish packages to npm if needed
- Future: can version packages independently

### Negative

- Developers need to learn workspace commands (`-w` flag)
- More `package.json` files to maintain
- Cross-package changes require understanding dependency graph
- Slightly more complex debugging

### Mitigations

1. **Root aliases** — Common commands work from root without `-w` flag
2. **Documentation** — Update README with workspace commands
3. **Shared config** — ESLint, Prettier at root, inherited by packages
4. **CI templates** — Provide copy-paste examples for common CI tasks

---

## Developer Impact

### Daily Workflow

| Task | Before | After |
|------|--------|-------|
| Install all | `npm install` | `npm install` (unchanged) |
| Run tests | `npm test` | `npm test` (unchanged) |
| Validate specs | `npm run validate` | `npm run validate` (unchanged) |
| Start mock server | `npm start` | `npm start` (unchanged) |
| Generate clients | `npm run clients:generate` | `npm run clients:generate` (unchanged) |
| Run one package's tests | N/A | `npm test -w @safety-net/mock-server` |
| Add dep to mock-server | Edit package.json | `npm install express -w @safety-net/mock-server` |

### When Developers Need Workspace Knowledge

- Adding dependencies to a specific package
- Running commands for just one package
- Debugging CI pipeline issues
- Understanding cross-package imports

---

## References

- [npm Workspaces Documentation](https://docs.npmjs.com/cli/v10/using-npm/workspaces)
- [Node.js Workspaces Guide](https://nodejs.org/api/packages.html#packages_package_entry_points)
