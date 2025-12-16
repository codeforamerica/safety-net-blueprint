# Safety Net OpenAPI Toolkit

This toolkit helps teams build consistent, well-documented APIs for safety net programs—enabling faster integration between benefits systems and reducing the technical barriers to improving service delivery.

It provides a standardized foundation for designing APIs that handle common patterns in benefits administration: searching and filtering records, managing cases and applications, and exchanging eligibility data between systems. By codifying these patterns into reusable templates and validation rules, teams can focus on their domain logic rather than reinventing API conventions.

The toolkit generates mock servers, TypeScript clients, and Postman collections from your OpenAPI specifications, making it easier to prototype integrations and onboard developers.

## Quick Start

```bash
npm install
npm start                # Mock server (1080) + Swagger UI (3000)
```

Visit `http://localhost:3000` for interactive API docs, or test directly:
```bash
curl http://localhost:1080/persons
```

## Commands

| Command | Description |
|---------|-------------|
| `npm start` | Start mock server + Swagger UI |
| `npm run validate` | Validate specs and examples |
| `npm run api:new -- --name "x" --resource "X"` | Generate new API from template |
| `npm run clients:generate` | Generate TypeScript/Zodios clients |
| `npm run postman:generate` | Generate Postman collection |
| `npm test` | Run unit tests |
| `npm run test:all` | Run all tests (unit + integration) |
| `npm run mock:reset` | Reset database to example data |

## Documentation

| Guide | Description |
|-------|-------------|
| [Creating APIs](./docs/README_CREATING_APIS.md) | Generate new APIs with established patterns |
| [Validation](./docs/README_VALIDATION.md) | Spec validation and linting rules |
| [Mock Server](./docs/README_MOCK_SERVER.md) | Search, pagination, and CRUD operations |
| [Testing](./docs/README_TESTING.md) | Unit tests, integration tests, Postman, Swagger UI |
| [API Clients](./docs/README_API_CLIENTS.md) | TypeScript/Zodios client generation |
| [Developer Guide](./docs/README_DEVELOPER.md) | Project structure, extending, troubleshooting |

## Requirements

Node.js >= 18.0.0

## License

[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/)
