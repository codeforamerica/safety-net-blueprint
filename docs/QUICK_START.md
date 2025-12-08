# Quick Start Guide

Get up and running with the Model App OpenAPI tools in 5 minutes!

## Prerequisites

- **Node.js >= 18.0.0** ([Installation Guide](./README_INSTALLATION.md))
- **Postman** (optional, for interactive testing)

## 1. Install Dependencies

```bash
npm install
```

## 2. Validate OpenAPI Specs (Recommended)

Validate your OpenAPI specifications and examples to catch errors early:

```bash
npm run validate
```

This checks that your specs are valid and examples match schemas. **Learn more:** [Validation Guide](./README_VALIDATION.md)

## 3. Generate API Clients (Optional)

Generate type-safe TypeScript clients from the OpenAPI specifications defined in the directory (`/openapi`):

```bash
npm run clients:generate
```
**Output:** `generated/clients/zodios/*.ts`

**Note:** This automatically validates specs before generating. Use `SKIP_VALIDATION=true` to skip validation.

**Learn more:** [API Client Generator Documentation](./README_API_CLIENTS.md)

## 4. Generate Postman Collection (Optional)

Generate a complete Postman collection with test scripts and examples from the OpenAPI specifications defined in the directory (`/openapi`) and the examples defined in the directory (`/openapi/examples`):

```bash
npm run postman:generate
```

**Output:** `generated/postman-collection.json`

Import into Postman to start testing immediately!

**Note:** This automatically validates specs and examples before generating.

**Learn more:** [Postman Collection Generator Documentation](./README_POSTMAN.md)

## 5. Start Servers

Start both mock server and Swagger UI:

```bash
npm start
```

**Servers available at:**
- Mock API: `http://localhost:1080`
- Swagger UI: `http://localhost:3000`

Or start them individually:

```bash
npm run mock:start      # Mock server only (port 1080)
npm run swagger:start   # Swagger UI only (port 3000)
```

**Note:** The setup process validates specs before seeding databases.

**Learn more:** [Mock Server Documentation](./README_MOCK_SERVER.md)

## 6. View API Documentation (Optional)

Launch Swagger UI to view interactive API documentation:

```bash
npm run swagger:start
```

Visit `http://localhost:3000` to browse all APIs with a beautiful interface and "Try it out" functionality.

**Learn more:** [Swagger UI Documentation](./README_SWAGGER.md)

## 7. You're Ready!

Your development environment is now set up with:

- ✅ **Mock Server** at `http://localhost:1080` - Full API backend
- ✅ **Swagger UI** at `http://localhost:3000` - Interactive docs
- ✅ **TypeScript Clients** in `src/clients/` - Type-safe API access
- ✅ **Postman Collection** in `generated/` - Automated testing

## Next Steps

Choose your workflow:

### For API Testing
- **[Testing Guide](./README_TESTING.md)** - Complete testing documentation (unit, integration, Postman, Swagger, curl)
- **[Mock Server Guide](./README_MOCK_SERVER.md)** - curl examples and endpoints
- **[Swagger UI Guide](./README_SWAGGER.md)** - Interactive testing in browser
- **[Postman Collection Guide](./README_POSTMAN.md)** - Test automation and collections

### For Development
- **[Developer Guide](./README_DEVELOPER.md)** - Adding APIs, project structure, extending functionality
- **[API Client Generator](./README_API_CLIENTS.md)** - TypeScript client usage and examples
- **[Installation Guide](./README_INSTALLATION.md)** - Detailed setup and requirements

## Quick Reference

```bash
# Validation
npm run validate         # Validate OpenAPI specs and examples

# Servers
npm start                # Start both servers (ports 1080 & 3000)
npm run mock:start       # Start mock server only (port 1080)
npm run swagger:start    # Start Swagger UI only (port 3000)

# Generators
npm run clients:generate # Generate TypeScript clients
npm run postman:generate # Generate Postman collection

# Testing
npm test                 # Run unit tests only
npm run test:unit        # Run unit tests only (explicit)
npm run test:integration # Run integration tests only
npm run test:all         # Run all tests (unit + integration)

# Utilities
npm run mock:reset       # Reset database
```

---

**Need help?** Check the troubleshooting sections in each guide above. 🚀
