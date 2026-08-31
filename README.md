# Safety Net Blueprint

A systems integration blueprint for safety net benefits programs. Contract artifacts — OpenAPI specs, state machines, decision rules, metrics, and field metadata — define the full API surface for backend development. States adopt the blueprint, customize it with overlays, and build adapters to their vendor systems. Frontends develop against a mock server without waiting for a production backend.

> **Frontend harness packages** (form engine, safety harness, harness designer) live in a separate repository: [codeforamerica/safety-net-harness](https://github.com/codeforamerica/safety-net-harness).

**New here?** Browse all diagrams and reference tools in the [Explorer hub](https://codeforamerica.github.io/safety-net-blueprint/packages/safety-net-explorer/).

## About This Repository

This repository contains the base contract artifacts, tooling, and documentation for the [contract-driven architecture](./docs/architecture/contract-driven-architecture.md). It provides:

- **Base contract artifacts** — OpenAPI specs, state machine definitions, decision rules, metrics, and field metadata that define both data operations (REST) and behavioral operations (RPC)
- **Conversion scripts** — generate contract YAML from tables (spreadsheets) so business users can author requirements directly
- **Validation** — check OpenAPI specs and cross-artifact consistency
- **Mock server** — interprets contracts with an in-memory database for development without a production backend, serving REST APIs, RPC APIs, and event streams
- **Field metadata** — annotations (program relevance, verification requirements, regulatory citations), field-level permissions, and multilingual labels as contract artifacts served by the backend
- **Client generation** — typed TypeScript SDK and Zod schemas from resolved specs
- **State overlays** — states customize contracts without forking the base files

## Repository Structure

The monorepo separates domain-agnostic framework tooling from safety-net-specific contracts:

| Package | npm name | Purpose |
|---------|----------|---------|
| `packages/blueprint-core` | `@codeforamerica/blueprint-core` | Framework library: overlay resolution, validation, state machines, annotations |
| `packages/blueprint-cli` | `@codeforamerica/blueprint-cli` | CLI scripts: `blueprint-resolve`, `blueprint-validate`, `blueprint-generate-ts-clients`, etc. |
| `packages/blueprint-mock-server` | `@codeforamerica/blueprint-mock-server` | Mock API server: `blueprint-mock`, `blueprint-swagger` |
| `packages/blueprint-explorer` | `@codeforamerica/blueprint-explorer` | Explorer build tooling (outputs to `packages/safety-net-explorer/`) |
| `packages/safety-net-contracts` | `@codeforamerica/blueprint-safety-net-contracts` | Safety-net domain contracts: OpenAPI specs, state machines, overlays |
| `packages/generated` | — | Generated artifacts: resolved specs, TypeScript clients, Postman collection (gitignored) |

`blueprint-core` and `blueprint-cli` are domain-agnostic — they can be used for any contract-driven project. `safety-net-contracts` depends on `blueprint-cli` and uses `blueprint-core` as its framework.

At the core of the blueprint is a domain-agnostic framework (`blueprint-core`) that implements the architectural patterns — contract-first API design, overlay-based customization, state machine-driven behavior, event-driven integration — as reusable tooling. The safety net contracts package applies these patterns to the safety net benefits domain. Other domains could use the same framework to build their own contract-driven systems.

## Adopting the Blueprint

To adopt the blueprint, create a repository, install the base packages, apply overlays to customize the contracts for your context, and point the CLIs at the resolved output. See the [Setup Guide](./docs/guides/setup-guide.md) for the full walkthrough and the [Overlay Guide](./docs/guides/overlay-guide.md) for overlay authoring.

## Getting Started

Choose your path based on your role:

| Role | You want to... | Start here |
|------|----------------|------------|
| **UX Designer** | Explore the data model and design reference | [UX Designer Guide](./docs/getting-started/ux-designers.md) |
| **Backend Developer** | Author contracts, validate specs, build production adapters | [Backend Developer Guide](./docs/getting-started/backend-developers.md) |
| **Frontend Developer** | Build UIs against REST and RPC APIs, use generated clients | [Frontend Developer Guide](./docs/getting-started/frontend-developers.md) |
| **Tester** | Run tests, write integration tests, test against the mock | [Tester Guide](./docs/getting-started/testers.md) |

## Quick Start

```bash
npm install

# Start mock server + Swagger UI
npm run mock:start:all
```

Visit `http://localhost:3000` for interactive API docs.

## Contributing

After cloning, run the one-time setup to install the pre-push git hook:

```bash
npm run setup:hooks
```

This installs a hook that runs before every push. The hook rebuilds explorer outputs and commits them if stale, then runs `npm run preflight` — which validates specs, runs tests, and runs integration tests. Use `git push --no-verify` to skip for work-in-progress pushes.

## Commands

| Command | Description |
|---------|-------------|
| `npm start` | Start mock server |
| `npm run mock:start:all` | Start mock server + Swagger UI |
| `npm run validate` | Validate OpenAPI specs |
| `npm run resolve -- --spec=<spec-dir> --overlay=<overlay-dir> --out=<out-dir>` | Resolve overlays against base specs |
| `npm run build --workspace=packages/blueprint-explorer` | Build all explorer reference tools |
| `node packages/blueprint-explorer/build.js --resolved=<dir> --clients=<dir>` | Build explorer from state-specific resolved specs |
| `npm run api:new` | Scaffold a new API spec |
| `npm run mock:reset` | Reset database to example data |
| `npm test` | Run unit tests |
| `npm run test:integration` | Run integration tests (includes Postman/newman) |

[Full command reference →](./docs/reference/commands.md)

## Documentation

### Architecture
- [Contract-Driven Architecture](./docs/architecture/contract-driven-architecture.md) — Contract artifacts, portability, adapter pattern
- [Domain Design](./docs/architecture/domains/domain-design.md) — Domain organization, entities, data flow
- [API Architecture](./docs/architecture/api-architecture.md) — API organization, operational concerns

### Guides
- [Setup Guide](./docs/guides/setup-guide.md) — Set up a repository with overlays and CI
- [Overlay Guide](./docs/guides/overlay-guide.md) — Customize contracts with overlays
- [Creating APIs](./docs/guides/creating-apis.md) — Design new API specifications
- [Validation](./docs/guides/validation.md) — Validate specs and fix errors
- [Mock Server](./docs/guides/mock-server.md) — Run and query the mock server
- [Search Patterns](./docs/guides/search-patterns.md) — Search and filter syntax

### Integration
- [API Clients](./docs/guides/api-clients.md) — Generated TypeScript clients
- [CI/CD for Backend](./docs/guides/ci-cd-backend.md) — Contract test your API implementation
- [CI/CD for Frontend](https://github.com/codeforamerica/safety-net-harness/blob/main/docs/integration/ci-cd-frontend.md) — Build and test frontend apps (in harness repo)

### Reference
- [Commands](./docs/reference/commands.md) — All available npm scripts
- [Project Structure](./docs/reference/project-structure.md) — File layout and conventions
- [Troubleshooting](./docs/reference/troubleshooting.md) — Common issues and solutions

## Changelogs

- [Safety Net Contracts](./packages/safety-net-contracts/CHANGELOG.md)
- [Mock Server](./packages/blueprint-mock-server/CHANGELOG.md)

## Requirements

Node.js >= 20.19.0

## License

[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/)
