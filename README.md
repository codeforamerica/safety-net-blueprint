# Safety Net APIs

> **Status: Work in progress** — The system is being designed incrementally, domain by domain, and proven through [steel thread prototypes](./docs/architecture/roadmap.md).

Portable, contract-driven APIs for safety net benefits systems. Contract artifacts — OpenAPI specs, state machines, decision rules, metrics, and form definitions — define the full API surface for both backend and frontend development. States can swap vendors without rebuilding their systems, and frontends can develop against a mock server and declarative form definitions without waiting for a production backend.

**New here?** Start with the [Executive Summary](https://codeforamerica.github.io/safety-net-apis/docs/presentation/executive-summary.html) for a one-page overview, the [Toolkit Overview](https://codeforamerica.github.io/safety-net-apis/docs/presentation/safety-net-openapi-overview.html) presentation for a detailed walkthrough, or the [ORCA Data Explorer](https://codeforamerica.github.io/safety-net-apis/docs/schema-reference.html) to browse the data model.

## About This Repository

This repository contains the base contract artifacts, tooling, and documentation for the [contract-driven architecture](./docs/architecture/contract-driven-architecture.md). It provides:

- **Base contract artifacts** — OpenAPI specs, state machine definitions, decision rules, metrics, and form definitions that define both data operations (REST) and behavioral operations (RPC)
- **Conversion scripts** — generate contract YAML from tables (spreadsheets) so business users can author requirements directly
- **Validation** — check OpenAPI specs and cross-artifact consistency
- **Mock server** — interprets contracts with an in-memory database for development without a production backend, serving REST APIs, RPC APIs, and event streams
- **Form definitions** — declarative YAML that drives context-dependent UI rendering — sections, fields, visibility conditions, and annotations — so the frontend doesn't hardcode domain-specific logic
- **Client generation** — typed TypeScript SDK and Zod schemas from resolved specs
- **State overlays** — states customize contracts without forking the base files

States create their own repositories, install the base packages (`@safety-net/schemas`, `@safety-net/mock-server`, `@safety-net/clients`), and apply overlays. See the [State Setup Guide](./docs/guides/state-setup-guide.md).

The architecture is being proven through [steel thread prototypes](./docs/architecture/roadmap.md) that exercise the most complex parts of the design before domains are built out at scale.

## Getting Started

Choose your path based on your role:

| Role | You want to... | Start here |
|------|----------------|------------|
| **UX Designer** | Explore the data model, populate Figma designs with sample data | [UX Designer Guide](./packages/schemas/docs/ux-designer-guide.md) |
| **Backend Developer** | Author contracts, validate specs, build production adapters | [Backend Developer Guide](./docs/getting-started/backend-developers.md) |
| **Frontend Developer** | Build UIs against REST and RPC APIs, use generated clients | [Frontend Developer Guide](./docs/getting-started/frontend-developers.md) |

## Quick Start

```bash
npm install

# Set your state
export STATE=<your-state>

# Start mock server + Swagger UI
npm start
```

Visit `http://localhost:3000` for interactive API docs.

## Commands

| Command | Description |
|---------|-------------|
| `npm start` | Start mock server + Swagger UI |
| `npm run validate` | Validate OpenAPI specs |
| `npm run overlay:resolve` | Resolve state overlay (requires STATE) |
| `npm run api:new` | Scaffold a new API spec |
| `npm run mock:reset` | Reset database to example data |
| `npm test` | Run unit tests |
| `npm run test:integration` | Run integration tests (includes Postman/newman) |

[Full command reference →](./docs/reference/commands.md)

## Documentation

### Architecture
- [Contract-Driven Architecture](./docs/architecture/contract-driven-architecture.md) — Contract artifacts, portability, adapter pattern
- [Domain Design](./docs/architecture/domain-design.md) — Domain organization, entities, data flow
- [API Architecture](./docs/architecture/api-architecture.md) — API organization, operational concerns
- [Roadmap](./docs/architecture/roadmap.md) — Phases, prototypes, future considerations

### Prototypes
- [Workflow Prototype](./docs/prototypes/workflow-prototype.md) — Behavioral contracts (state machine, rules, metrics)
- [Application Review Prototype](./docs/prototypes/application-review-prototype.md) — Form definitions and context-dependent UI

### Guides
- [State Setup Guide](./docs/guides/state-setup-guide.md) — Set up a state repository with overlays and CI
- [Creating APIs](./docs/guides/creating-apis.md) — Design new API specifications
- [State Overlays](./docs/guides/state-overlays.md) — Customize contracts for state-specific needs
- [Validation](./docs/guides/validation.md) — Validate specs and fix errors
- [Mock Server](./docs/guides/mock-server.md) — Run and query the mock server
- [Search Patterns](./docs/guides/search-patterns.md) — Search and filter syntax

### Integration
- [API Clients](./docs/integration/api-clients.md) — Generated TypeScript clients
- [CI/CD for Backend](./docs/integration/ci-cd-backend.md) — Contract test your API implementation
- [CI/CD for Frontend](./docs/integration/ci-cd-frontend.md) — Build and test frontend apps

### Reference
- [Commands](./docs/reference/commands.md) — All available npm scripts
- [Project Structure](./docs/reference/project-structure.md) — File layout and conventions
- [Troubleshooting](./docs/reference/troubleshooting.md) — Common issues and solutions

### Decisions
- [Multi-State Overlays](./docs/decisions/multi-state-overlays.md)
- [Search Patterns](./docs/decisions/search-patterns.md)

## Requirements

Node.js >= 20.19.0

## License

[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/)
