# Mock Server

Automatically generate mock servers from OpenAPI specifications with realistic responses from your example data.

## Overview

Creates fully functional mock APIs that match your OpenAPI specifications, with responses automatically populated from your example data.

**Features:**
- ✅ Automatic endpoint creation from OpenAPI specs
- ✅ Realistic responses from examples
- ✅ Support for all HTTP methods
- ✅ Query parameters, path parameters, and request bodies
- ✅ Multiple scenarios (success, errors, edge cases)

**Example:**
```bash
# Start both servers
npm start

# Or start mock server only
npm run mock:start

# Test it
curl http://localhost:1080/persons
```

## Technology Stack

- **Express** - Web server framework
- **SQLite** (better-sqlite3) - Persistent data storage
- **AJV** - JSON Schema validation
- **js-yaml** - OpenAPI spec parsing
- **@apidevtools/json-schema-ref-parser** - Reference resolution

## Quick Start

```bash
# Start the mock server
npm run mock:start

# Server available at: http://localhost:1080

# Test it
curl http://localhost:1080/persons
```

## Available Commands

| Command | Description |
|---------|-------------|
| `npm run mock:start` | Start the mock server (auto-creates databases from examples) |
| `npm run mock:setup` | Initialize databases with example data |
| `npm run mock:reset` | Clear databases and reseed from examples |

## Configuration

### Environment Variables

Customize the server host and port:

```bash
MOCK_SERVER_HOST=localhost MOCK_SERVER_PORT=8080 npm run mock:start
```

**Defaults:**
- Host: `localhost`
- Port: `1080`

## How It Works

The mock server automatically:

1. **Discovers OpenAPI specifications** from `/openapi/`
2. **Seeds SQLite databases** from `/openapi/examples/`
3. **Generates Express routes** for each endpoint
4. **Validates requests** against OpenAPI schemas
5. **Returns data** from the database with pagination/search support

### Example: Auto-Generated Endpoints

From `/openapi/persons.yaml`, the server automatically creates:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/persons` | List all (with pagination & search) |
| GET | `/persons/{personId}` | Get one by ID |
| POST | `/persons` | Create new person |
| PATCH | `/persons/{personId}` | Update person |
| DELETE | `/persons/{personId}` | Delete person |

Data is seeded from `/openapi/examples/persons.yaml` into SQLite.

## Usage Examples

### Basic HTTP Requests

```bash
# List all persons
curl http://localhost:1080/persons

# Search for persons
curl http://localhost:1080/persons?search=Avery

# Get a specific person
curl http://localhost:1080/persons/4d1f13f0-3e26-4c50-b2fb-8d140f7ec1c2

# Create a person
curl -X POST http://localhost:1080/persons \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Jordan",
    "lastName": "Fields",
    "email": "jordan.fields@example.com",
    "dateOfBirth": "1990-03-20",
    "phoneNumber": "+1-555-765-4321",
    "address": {
      "addressLine1": "456 Market St",
      "city": "Chicago",
      "stateProvince": "IL",
      "postalCode": "60605",
      "country": "US"
    },
    "citizenshipStatus": "citizen",
    "householdSize": 3,
    "monthlyIncome": 5800
  }'

# Update a person
curl -X PATCH http://localhost:1080/persons/4d1f13f0-3e26-4c50-b2fb-8d140f7ec1c2 \
  -H "Content-Type: application/json" \
  -d '{"monthlyIncome": 6400}'

# Delete a person
curl -X DELETE http://localhost:1080/persons/4d1f13f0-3e26-4c50-b2fb-8d140f7ec1c2
```

### Programmatic Access

The mock server is a standard Express server, so you can use any HTTP client:

```javascript
// Using fetch
const response = await fetch('http://localhost:1080/persons');
const data = await response.json();

// Using axios
const { data } = await axios.get('http://localhost:1080/persons');

// Create a new resource
const newPerson = await fetch('http://localhost:1080/persons', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    firstName: 'Jordan',
    lastName: 'Fields',
    email: 'jordan@example.com'
  })
});
```

## Architecture

### How It Works

The mock server automatically generates a fully functional API:

```
OpenAPI Specs (/openapi/*.yaml)
         ↓
    Auto-discovered on startup
         ↓
Examples (/openapi/examples/*.yaml)
         ↓
    Seeds SQLite databases
         ↓
Express Routes Generated
         ↓
    CRUD endpoints available
         ↓
Requests validated against schemas
         ↓
    Responses from database
```

### Components

1. **`openapi-loader.js`** - Discovers and parses specs
2. **`route-generator.js`** - Creates Express routes dynamically
3. **`database-manager.js`** - Manages SQLite databases
4. **`handlers/`** - CRUD operation handlers
5. **`validator.js`** - Request/response validation
6. **`seeder.js`** - Populates databases from examples

## Query Parameters & Filtering

The mock server automatically supports:

**Standard Parameters:**
- `limit` - Number of items per page (default: 25)
- `offset` - Number of items to skip (default: 0)
- `search` - Full-text search across resource fields

**Examples:**
```bash
# Pagination
curl "http://localhost:1080/persons?limit=10&offset=20"

# Search
curl "http://localhost:1080/persons?search=Avery"

# Combined
curl "http://localhost:1080/persons?search=Rivera&limit=5"
```

The search parameter automatically searches across all string fields in your resource.

## Adding New APIs

The mock server **automatically discovers and generates endpoints** from OpenAPI specs. No manual coding required!

### Steps to Add a New API

1. **Create OpenAPI spec** in `/openapi/`
   ```bash
   # Create your spec file
   /openapi/products.yaml
   ```

2. **Create example data** in `/openapi/examples/`
   ```bash
   # Create matching examples file
   /openapi/examples/products.yaml
   ```

3. **Restart the server**
   ```bash
   npm run mock:start
   ```

4. **Endpoints are automatically available!**
   ```bash
   curl http://localhost:1080/products
   ```

**That's it!** The mock server:
- ✅ Discovers your new spec automatically
- ✅ Generates all CRUD endpoints
- ✅ Seeds database from your examples
- ✅ Validates requests against your schemas

See the [Developer Guide](./README_DEVELOPER.md) for detailed patterns on creating OpenAPI specs and examples.

## Testing

### Running Tests

```bash
# Unit tests only (no server needed)
npm test
# or explicitly
npm run test:unit

# Integration tests only (auto-starts server if needed)
npm run test:integration

# Run all tests (unit + integration)
npm run test:all

# Or manually start server first (optional)
npm run mock:start           # Terminal 1
npm run test:integration     # Terminal 2
```

See the [Testing Guide](./README_TESTING.md) for comprehensive testing documentation.

### Writing Tests

Example integration test:

```javascript
// Test create-update-delete flow
async function testLifecycle() {
  // Create
  const createRes = await fetch('http://localhost:1080/persons', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: { firstName: 'Test', lastName: 'User' },
      email: 'test@example.com',
      dateOfBirth: '1990-01-01',
      citizenshipStatus: 'citizen',
      householdSize: 1,
      monthlyIncome: 5000
    })
  });
  const person = await createRes.json();
  
  // Update
  const updateRes = await fetch(`http://localhost:1080/persons/${person.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ monthlyIncome: 6000 })
  });
  
  // Delete
  await fetch(`http://localhost:1080/persons/${person.id}`, {
    method: 'DELETE'
  });
}
```

## Project Structure

```
/
├── openapi/                    # OpenAPI specifications
│   ├── *.yaml                  # API specs (auto-discovered)
│   ├── components/             # Shared schemas
│   └── examples/               # Example data (seeds databases)
│
├── src/mock-server/            # Mock server core
│   ├── openapi-loader.js       # Discovers and parses specs
│   ├── route-generator.js      # Generates Express routes
│   ├── database-manager.js     # SQLite operations
│   ├── seeder.js               # Seeds data from examples
│   ├── validator.js            # Request validation
│   └── handlers/               # CRUD handlers
│
├── generated/mock-data/        # SQLite databases (gitignored)
│   └── *.db                    # One database per API
│
└── scripts/mock-server/        # CLI scripts
    ├── server.js               # Start server
    ├── setup.js                # Initialize databases
    └── reset.js                # Reset databases
```

## Troubleshooting

### Port Already in Use

**Issue:** Error starting server on port 1080

**Solutions:**
- Stop existing service: `lsof -ti:1080 | xargs kill`
- Use different port: `MOCK_SERVER_PORT=8080 npm run mock:start`

### Server Not Responding

**Issue:** Requests timeout or fail

**Solutions:**
1. Check if server is running: `curl http://localhost:1080/persons`
2. Restart the server: Stop with Ctrl+C, then `npm run mock:start`
3. Check logs for errors

### Wrong Response Data

**Issue:** Endpoints return incorrect or unexpected data

**Solutions:**
1. Check your example files match your schemas: `npm run validate`
2. Reset databases: `npm run mock:reset`
3. Verify examples are being loaded: Check `generated/mock-data/*.db`
4. Restart server: `npm run mock:start`

### Search Not Working

**Issue:** Search queries don't filter results

**Solutions:**
1. Check that your examples have string fields to search
2. Verify the search parameter is being passed correctly
3. Check database was seeded: `ls generated/mock-data/*.db`

## Best Practices

### 1. Keep Examples Up to Date
- Update examples when API changes
- Match example data structure to schemas
- Include realistic data

### 2. Use Descriptive Example Names
```yaml
examples:
  default:              # ✓ Good
    $ref: '#/PersonListDefault'
  
  example1:             # ✗ Bad
    $ref: '#/Example1'
```

### 3. Test Different Scenarios
- Success responses (200, 201, 204)
- Client errors (400, 404, 409, 422)
- Server errors (500, 503)
- Edge cases (empty lists, search with no results)

### 4. Use Version Control
```gitignore
# Commit specs and examples
openapi/*.yaml
openapi/components/**/*.yaml

# Commit mock server code
scripts/mock-server/*.js
```

### 5. Keep Schemas and Examples in Sync
- Update examples when schemas change
- Run `npm run validate` to check for mismatches
- Use realistic, diverse test data

## Additional Resources

- [Developer Guide](./README_DEVELOPER.md) - Creating OpenAPI specs and examples
- [Validation Guide](./README_VALIDATION.md) - Validating specs and examples
- [OpenAPI Specification](https://swagger.io/specification/)

## Related Documentation

- [API Client Generator](./README_API_CLIENTS.md) - Generate Zodios clients from OpenAPI specs
- [Main README](../README.md) - Project overview
