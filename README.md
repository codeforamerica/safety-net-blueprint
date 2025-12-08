# OpenAPI Tools: Validation, Client Generator, Mock Server, Swagger UI & Postman Collection

This project provides five powerful tools for working with OpenAPI specifications:

1. **[Validation Utility](./docs/README_VALIDATION.md)** - Validate OpenAPI specs and examples to catch errors early
2. **[API Client Generator](./docs/README_API_CLIENTS.md)** - Generate type-safe clients from OpenAPI specs
3. **[Mock Server](./docs/README_MOCK_SERVER.md)** - Create mock APIs with realistic responses from OpenAPI specifications and examples. A SQLite persistence layer supports creation of test and/or demo data sets.
4. **[Swagger UI](./docs/README_SWAGGER.md)** - Interactive API documentation with "Try it out" functionality
5. **[Postman Collection Generator](./docs/README_POSTMAN.md)** - Auto-generate Postman collections with tests from OpenAPI specifications and examples

## Quick Start

Get up and running in minutes! **[→ Full Quick Start Guide](./docs/QUICK_START.md)**

```bash
# Install dependencies
npm install

# Validate OpenAPI specs and examples under /openapi (recommended)
npm run validate

# Generate TypeScript clients (optional)
npm run clients:generate

# Generate Postman collection (optional)
npm run postman:generate

# Start both mock server & Swagger UI
npm start

# Or start them individually:
npm run mock:start      # Mock server only (port 1080)
npm run swagger:start   # Swagger UI only (port 3000)
```

**What you get:**
- Mock API server at `http://localhost:1080`
- Swagger UI at `http://localhost:3000`
- Type-safe TypeScript clients
- Postman collection with automated tests

## Features

✅ **Auto-discovery** - Automatically finds and loads all OpenAPI specs  
✅ **Type-safe clients** - Generate TypeScript/Zodios clients with full type safety  
✅ **Mock server** - Persistent SQLite databases with realistic data  
✅ **Interactive docs** - Swagger UI with "Try it out" functionality  
✅ **Test automation** - Postman collections with automated test scripts  
✅ **Example-driven** - Uses your OpenAPI examples for realistic responses  
✅ **Spec validation** - Validate OpenAPI specs and examples before generation  
✅ **Request validation** - Validate requests/responses against OpenAPI schemas  
✅ **Search & pagination** - Built-in support for filtering and pagination  

## Available Commands

### Validation

| Command | Description |
|---------|-------------|
| `npm run validate` | Validate OpenAPI specs and examples |

### API Client Generator & Postman

| Command | Description |
|---------|-------------|
| `npm run clients:generate` | Generate Zodios clients from OpenAPI specs |
| `npm run postman:generate` | Generate Postman collection with tests and examples |

### Mock Server & Documentation

| Command | Description |
|---------|-------------|
| `npm start` | Start both mock server (1080) & Swagger UI (3000) |
| `npm run mock:start` | Start mock server only (port 1080) |
| `npm run mock:setup` | Initialize databases with example data |
| `npm run mock:reset` | Clear databases and reseed from examples |
| `npm run swagger:start` | Start Swagger UI only (port 3000) |

### Testing

| Command | Description |
|---------|-------------|
| `npm test` | Run unit tests only |
| `npm run test:unit` | Run unit tests only (explicit) |
| `npm run test:integration` | Run integration tests only (auto-starts server if needed) |
| `npm run test:all` | Run all tests (unit + integration) |

**Learn more:** [Testing Documentation](./docs/README_TESTING.md)


## Use Cases

### Development
- **Frontend development** without waiting for backend
- **Parallel development** of frontend and backend teams
- **Rapid prototyping** with realistic data

### Testing
- **Automated testing** with unit and integration tests
- **Interactive testing** with Postman and Swagger UI
- **Contract testing** with OpenAPI specs as source of truth
- **CI/CD integration** with Newman and automated test suites

## Documentation

### Getting Started
- **[Quick Start Guide](./docs/QUICK_START.md)** - Get up and running in 5 minutes
- **[Installation Guide](./docs/README_INSTALLATION.md)** - Node.js requirements and setup

### Core Documentation
- **[Validation Guide](./docs/README_VALIDATION.md)** - Validate OpenAPI specs and examples
- **[API Client Generator](./docs/README_API_CLIENTS.md)** - Generate type-safe TypeScript clients
- **[Mock Server](./docs/README_MOCK_SERVER.md)** - Complete mock server guide
- **[Swagger UI](./docs/README_SWAGGER.md)** - Interactive API documentation
- **[Postman Collection Generator](./docs/README_POSTMAN.md)** - Auto-generate Postman collections with tests

### Reference
- **[Developer Guide](./docs/README_DEVELOPER.md)** - Project structure, adding APIs, extending functionality, generated files
- **[Testing](./docs/README_TESTING.md)** - Comprehensive testing guide (unit, integration, Postman, Swagger, curl)

## Requirements

- **Node.js** >= 18.0.0
- **npm** (comes with Node.js)

**See [Installation Guide](./docs/README_INSTALLATION.md) for detailed setup instructions.**

## License

This project is licensed under the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/).

See the [LICENSE](./LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

For issues and questions:
- [Installation Guide](./docs/README_INSTALLATION.md) - Setup and troubleshooting
- [Developer Guide](./docs/README_DEVELOPER.md) - Adding APIs and extending functionality
- [Testing Documentation](./docs/README_TESTING.md) - Running and writing tests
