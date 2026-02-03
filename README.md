# Safety Net OpenAPI Toolkit

This toolkit helps teams build consistent, well-documented APIs for safety net programs—enabling faster integration between benefits systems and reducing the technical barriers to improving service delivery.

**New here?** Start with the [Executive Summary](https://codeforamerica.github.io/safety-net-apis/docs/presentation/executive-summary.html) for a one-page overview, the [Toolkit Overview](https://codeforamerica.github.io/safety-net-apis/docs/presentation/safety-net-openapi-overview.html) presentation for a detailed walkthrough, or the [ORCA Data Explorer](https://codeforamerica.github.io/safety-net-apis/docs/schema-reference.html) to browse the data model.

## About This Repository

This is an evolving repository where Code for America stores integrated benefits API specifications for the different states we work with. The specifications are built on a common data model that captures the core concepts shared across safety net programs—applications, households, income, eligibility—while allowing for state-specific variations in terminology, program names, and data requirements.

## Getting Started

Choose your path based on your role:

| Role | You want to... | Start here |
|------|----------------|------------|
| **UX Designer** | Explore the ORCA data model, populate Figma designs with sample data | [UX Designer Guide](./packages/schemas/docs/ux-designer-guide.md) |
| **Backend Developer** | Design APIs, validate specs, test backend implementations | [Backend Developer Guide](./docs/getting-started/backend-developers.md) |
| **Frontend Developer** | Build UIs against the APIs, use generated clients | [Frontend Developer Guide](./docs/getting-started/frontend-developers.md) |

## Quick Start

```bash
npm install

# Set your state
export STATE=california

# Start mock server + Swagger UI
npm start
```

Visit `http://localhost:3000` for interactive API docs.

## Commands

| Command | Description |
|---------|-------------|
| `npm start` | Start mock server + Swagger UI |
| `npm run validate` | Validate specs (uses STATE if set) |
| `npm run validate:all-states` | Validate all states |
| `npm run clients:build-package` | Build state-specific npm package (requires `--state` and `--version`) |
| `npm run postman:generate` | Generate Postman collection |
| `npm run mock:reset` | Reset database to example data |
| `npm test` | Run unit tests |
| `npm run test:integration` | Run integration tests (includes Postman/newman) |

[Full command reference →](./docs/reference/commands.md)

## Documentation

### Guides
- [Creating APIs](./docs/guides/creating-apis.md) — Design new API specifications
- [State Overlays](./docs/guides/state-overlays.md) — Work with state-specific variations
- [Validation](./docs/guides/validation.md) — Validate specs and fix errors
- [Mock Server](./docs/guides/mock-server.md) — Run and query the mock server
- [Search Patterns](./docs/guides/search-patterns.md) — Search and filter syntax

### Integration
- [CI/CD for Backend](./docs/integration/ci-cd-backend.md) — Contract test your API implementation
- [CI/CD for Frontend](./docs/integration/ci-cd-frontend.md) — Build and test frontend apps
- [API Clients](./docs/integration/api-clients.md) — Use generated TypeScript clients

### Reference
- [Commands](./docs/reference/commands.md) — All available npm scripts
- [Project Structure](./docs/reference/project-structure.md) — File layout and conventions
- [Troubleshooting](./docs/reference/troubleshooting.md) — Common issues and solutions

### Architecture Decisions
- [Multi-State Overlays](./docs/architecture-decisions/multi-state-overlays.md)
- [Search Patterns](./docs/architecture-decisions/search-patterns.md)

## Requirements

Node.js >= 20.19.0

## License

[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/)
