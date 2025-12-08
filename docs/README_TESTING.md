# Testing Guide

Comprehensive testing guide covering unit tests, integration tests, and interactive testing approaches.

## Quick Start

```bash
# Run unit tests only (fast, no server needed)
npm test
# or
npm run test:unit

# Run integration tests only (automatically starts server if needed)
npm run test:integration

# Run both unit and integration tests
npm run test:all

# Start servers for manual testing
npm start                # Both mock server & Swagger UI
# or
npm run mock:start       # Mock server only
```

## Test Structure

```
tests/mock-server/
├── unit/                           # Unit tests (fast, no server)
│   ├── openapi-loader.test.js      # Spec discovery & loading
│   ├── openapi-validator.test.js   # Spec & example validation
│   ├── seeder.test.js              # Database seeding
│   ├── database-manager.test.js    # SQLite operations
│   ├── handlers.test.js            # CRUD operations
│   ├── search-engine.test.js       # Search & filtering
│   ├── schema-resolution.test.js   # $ref resolution
│   ├── data-generation.test.js     # Data generation
│   └── list-response.test.js       # List response structure
│
├── integration/                    # Integration tests (need server)
│   └── integration.test.js         # Full request/response tests
│
└── run-all-tests.js                # Test runner
```

## Testing Approaches

### 1. Unit Tests (Primary)
Fast, isolated tests of core functionality without external dependencies.

**What's tested:**
- OpenAPI spec discovery and loading
- Spec and example validation
- Database operations (create, read, update, delete)
- Search and pagination logic
- Schema resolution and data generation

**Run:**
```bash
# Run unit tests only
npm test
# or
npm run test:unit
```

### 2. Integration Tests
End-to-end tests against a live mock server.

**What's tested:**
- Full CRUD lifecycle
- Request validation
- Multi-API support
- Error responses (404, 422)
- Pagination and search

**Run:**
```bash
# Run integration tests (automatically starts server if needed)
npm run test:integration

# Or manually start server first (optional)
npm run mock:start          # Terminal 1
npm run test:integration    # Terminal 2
```

**Note:** Integration tests automatically detect if the mock server is running. If not, they'll start it and clean it up when done.

### 3. Interactive Testing
Manual testing with Postman or Swagger UI.

**Run:**
```bash
# Generate Postman collection
npm run postman:generate

# Start Swagger UI
npm run swagger:start
```

## Unit Tests

### Running All Unit Tests

```bash
# Run unit tests only
npm test
# or explicitly
npm run test:unit
```

This runs all tests in `tests/mock-server/unit/` automatically.

### What Gets Tested

**OpenAPI Processing:**
- ✅ Spec discovery from `/openapi/` directory
- ✅ YAML parsing and loading
- ✅ `$ref` resolution (internal and external)
- ✅ Metadata extraction (endpoints, schemas, parameters)

**Validation:**
- ✅ OpenAPI spec structure and syntax
- ✅ Examples match their schemas
- ✅ Required fields present
- ✅ No additional properties (when restricted)

**Database Operations:**
- ✅ SQLite table creation
- ✅ JSON data storage and retrieval
- ✅ Seeding from examples
- ✅ CRUD operations (create, read, update, delete)
- ✅ Search and filtering
- ✅ Pagination (limit, offset)

**Schema Processing:**
- ✅ Local `$ref` resolution
- ✅ External file `$ref` resolution
- ✅ Circular reference handling
- ✅ Data generation from schemas

**List Responses:**
- ✅ Correct pagination structure
- ✅ Metadata fields (total, limit, offset, hasNext)
- ✅ Ordered by createdAt DESC

### Running Individual Tests

```bash
# Run specific unit test
node tests/mock-server/unit/openapi-loader.test.js
node tests/mock-server/unit/seeder.test.js
node tests/mock-server/unit/handlers.test.js

# Run integration test (server must be running)
node tests/mock-server/integration/integration.test.js
```

### Writing Custom Unit Tests

Add new test files to `tests/mock-server/unit/`:

```javascript
// tests/mock-server/unit/my-feature.test.js
import { test } from 'node:test';
import assert from 'node:assert';

test('My Feature Tests', async (t) => {
  await t.test('should do something', () => {
    const result = myFunction();
    assert.strictEqual(result, expected);
    console.log('  ✓ Test passed');
  });
});

console.log('\n✓ All my feature tests passed\n');
```

The test runner will automatically discover and run it.

## Integration Tests

### Running Integration Tests

Integration tests validate the full API behavior against a running mock server.

**Quick Start:**
```bash
# Run integration tests only (auto-starts server if needed)
npm run test:integration
```

**Run All Tests:**
```bash
# Run both unit and integration tests
npm run test:all
```

**Manual Server Control (Optional):**
```bash
# Terminal 1: Start server manually
npm run mock:start

# Terminal 2: Run tests
npm run test:integration
```

**How It Works:**
- Tests check if server is running on `localhost:1080`
- If not running, server is started automatically
- Server is stopped when tests complete (only if started by tests)
- If server was already running, it stays running after tests

### What Gets Tested

**Auto-Discovery:**
- ✅ Server loads all OpenAPI specs automatically
- ✅ Multiple APIs running simultaneously
- ✅ Endpoints generated from specs

**CRUD Operations:**
- ✅ GET /resources - List all with pagination
- ✅ GET /resources?search=query - Search filtering
- ✅ GET /resources/{id} - Get single resource
- ✅ POST /resources - Create new resource
- ✅ PATCH /resources/{id} - Update resource
- ✅ DELETE /resources/{id} - Delete resource

**Request Validation:**
- ✅ Valid requests succeed
- ✅ Invalid requests return 422 with error details
- ✅ Missing required fields are caught
- ✅ Schema validation enforced

**Error Responses:**
- ✅ 404 for non-existent resources
- ✅ 422 for validation errors
- ✅ Error responses have correct structure (code, message, details)

**Query Parameters:**
- ✅ Pagination (limit, offset)
- ✅ Search across fields
- ✅ Combined filters

### Example Integration Test

```javascript
// Example: Testing create-update-delete flow
describe('Person lifecycle', () => {
  let personId;
  
  test('Create person', async () => {
    const response = await fetch('http://localhost:1080/persons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: { firstName: 'Test', lastName: 'User' },
        email: 'test@example.com',
        dateOfBirth: '1990-01-01'
      })
    });
    
    assert.strictEqual(response.status, 201);
    const data = await response.json();
    personId = data.id;
  });
  
  test('Update person', async () => {
    const response = await fetch(`http://localhost:1080/persons/${personId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monthlyIncome: 5000 })
    });
    
    assert.strictEqual(response.status, 200);
  });
  
  test('Delete person', async () => {
    const response = await fetch(`http://localhost:1080/persons/${personId}`, {
      method: 'DELETE'
    });
    
    assert.strictEqual(response.status, 204);
  });
});
```

---

## Testing with Postman

Generate and run automated API tests using Postman collections.

**Quick start:**
```bash
npm run postman:generate    # Generate collection
npm run mock:start          # Start server
# Import generated/postman-collection.json into Postman
```

**Features:**
- ✅ Auto-generated collection from OpenAPI specs
- ✅ Automated test scripts on every request
- ✅ Multiple request variations per endpoint
- ✅ CI/CD integration with Newman

**Full documentation:** [Postman Collection Guide](./README_POSTMAN.md)

---

## Testing with Swagger UI

Interactive browser-based testing with "Try it out" functionality.

### Quick Start

```bash
# Start Swagger UI
npm run swagger:start

# Start mock server
npm run mock:start
```

**Visit:** `http://localhost:3000`

### Testing Workflow

**Example: Test GET endpoint**
1. Navigate to `http://localhost:3000/persons`
2. Expand `GET /persons`
3. Click **Try it out**
4. Set parameters (e.g., `limit: 2`, `offset: 0`)
5. Click **Execute**
6. View response with status code, headers, and body

**Example: Test POST endpoint**
1. Navigate to `http://localhost:3000/persons`
2. Expand `POST /persons`
3. Click **Try it out**
4. Edit request body (pre-filled with example data)
5. Click **Execute**
6. View created resource with new ID and timestamps

**Example: Test Search**
1. Navigate to `http://localhost:3000/persons`
2. Expand `GET /persons`
3. Click **Try it out**
4. Set `search: Avery`
5. Click **Execute**
6. View filtered results

### Benefits

✅ **Visual:** See request/response in beautiful UI  
✅ **Quick:** No setup, just click and test  
✅ **Documentation:** Schema definitions visible  
✅ **Shareable:** Send URL to stakeholders  

### Limitations

⚠️ **No test automation** - Manual verification only  
⚠️ **No collections** - Can't save request groups  
⚠️ **Session-based** - No persistent environment  

**Learn more:** [Swagger UI Documentation](./README_SWAGGER.md)

---

## Command-Line Testing

Direct API testing using curl or similar tools.

### Basic Examples

**List all persons:**
```bash
curl http://localhost:1080/persons
```

**Get specific person:**
```bash
curl http://localhost:1080/persons/4d1f13f0-3e26-4c50-b2fb-8d140f7ec1c2
```

**Search persons:**
```bash
curl "http://localhost:1080/persons?search=Avery&limit=10"
```

**Create person:**
```bash
curl -X POST http://localhost:1080/persons \
  -H "Content-Type: application/json" \
  -d '{
    "name": { "firstName": "Test", "lastName": "User" },
    "email": "test@example.com",
    "dateOfBirth": "1990-01-01",
    "phoneNumber": "+1-555-000-0000",
    "citizenshipStatus": "citizen",
    "householdSize": 1,
    "monthlyIncome": 3000
  }'
```

**Update person:**
```bash
curl -X PATCH http://localhost:1080/persons/4d1f13f0-3e26-4c50-b2fb-8d140f7ec1c2 \
  -H "Content-Type: application/json" \
  -d '{ "monthlyIncome": 3500 }'
```

**Delete person:**
```bash
curl -X DELETE http://localhost:1080/persons/4d1f13f0-3e26-4c50-b2fb-8d140f7ec1c2
```

### Pretty-Print JSON

```bash
curl http://localhost:1080/persons | jq .
```

### Include Headers

```bash
curl -i http://localhost:1080/persons
```

### Verbose Output

```bash
curl -v http://localhost:1080/persons
```

---

## Comparison of Testing Approaches

| Feature | Unit Tests | Integration Tests | Postman | Swagger UI | curl |
|---------|-----------|-------------------|---------|------------|------|
| **Automation** | ✅ Full | ✅ Full | ✅ Yes | ❌ Manual | ⚠️ Scriptable |
| **Speed** | ✅ Fast | ⚠️ Medium | ⚠️ Medium | ⚠️ Medium | ✅ Fast |
| **Setup** | ✅ None | ✅ Auto-start | ⚠️ Import required | ⚠️ Server required | ✅ None |
| **CI/CD** | ✅ Perfect | ✅ Perfect | ✅ Newman | ❌ No | ✅ Easy |
| **Visual** | ❌ Terminal | ❌ Terminal | ✅ GUI | ✅ Beautiful | ❌ Terminal |
| **Documentation** | ❌ No | ❌ No | ⚠️ Some | ✅ Excellent | ❌ No |
| **Test Scripts** | ✅ Full control | ✅ Full control | ✅ JavaScript | ❌ No | ⚠️ Manual |
| **Collections** | ✅ Test suites | ✅ Test suites | ✅ Organized | ❌ No | ❌ No |

### Recommendations

**Use Unit Tests for:**
- Continuous integration
- Regression testing
- Schema validation
- Core logic testing

**Use Integration Tests for:**
- End-to-end validation
- API contract testing
- Before deployments

**Use Postman for:**
- Manual API testing with automated validation
- Sharing test collections with your team
- CI/CD integration ([details](./README_POSTMAN.md#cicd-integration-with-newman))

**Use Swagger UI for:**
- API documentation
- Stakeholder demos
- Quick one-off tests
- Schema exploration

**Use curl for:**
- Quick debugging
- CI/CD pipelines
- Shell scripting
- Simple automation

---

## Best Practices

### 1. Test Early and Often

Run tests after:
- Updating OpenAPI specs
- Changing example data
- Modifying mock server code
- Adding new endpoints

### 2. Use Multiple Approaches

Combine different testing methods:
- **Unit tests** for CI/CD
- **Postman** for manual verification
- **Swagger UI** for documentation and demos
- **curl** for quick debugging

### 3. Keep Tests Independent

Each test should:
- Set up its own data
- Clean up after itself
- Not depend on other tests
- Be runnable in any order

### 4. Test Error Cases

Don't just test happy paths:
- ✅ 404 for missing resources
- ✅ 400 for invalid requests
- ✅ 422 for validation errors
- ✅ Edge cases (empty strings, nulls, etc.)

### 5. Use Realistic Data

Test with data that represents real-world scenarios:
- Valid examples from OpenAPI specs
- Edge cases (min/max values)
- Different data combinations
- Special characters and formats

### 6. Document Your Tests

Add comments and descriptions:
```javascript
// Test: Verify pagination returns correct number of items
pm.test("Pagination works correctly", function () {
    const jsonData = pm.response.json();
    pm.expect(jsonData.items).to.have.lengthOf(2);
});
```

### 7. Automate Regression Testing

Set up CI/CD to run tests automatically:
- On every commit
- On pull requests
- Before deployments
- On schedule (nightly builds)

---

## Troubleshooting

### Integration Tests Failing

**Issue:** Integration tests fail to start or connect

**Solutions:**
1. Check if port 1080 is already in use: `lsof -i :1080`
2. Kill existing process: `kill -9 <PID>`
3. Or use a different port: `MOCK_SERVER_PORT=3000 npm run test:integration`
4. Check for OpenAPI validation errors in output
5. Verify OpenAPI specs are valid: `npm run validate`

### Connection Refused (Manual Server)

**Issue:** Tests can't connect when running manually started server

**Solutions:**
1. Wait for server to fully start (watch for "Server ready" message)
2. Verify server is running: `curl http://localhost:1080/persons`
3. Check for error messages in server terminal
4. Verify port matches in test and server

### Invalid Responses

**Issue:** Responses don't match expected format

**Solutions:**
1. Regenerate databases: `npm run mock:reset`
2. Check OpenAPI specs are valid
3. Verify example data matches schemas
4. Review validation error messages

### Postman Issues

**Issue:** Tests not running or collection problems

**Solution:** See the [Postman Troubleshooting Guide](./README_POSTMAN.md#troubleshooting) for detailed solutions

### Slow Tests

**Issue:** Tests take too long to run

**Solutions:**
1. Use unit tests for fast feedback
2. Run integration tests separately
3. Parallelize Postman tests using Newman
4. Reduce number of test iterations

---

## Summary

This project provides comprehensive testing capabilities:

✅ **Automated unit tests** - Fast, no dependencies  
✅ **Integration tests** - Full API validation  
✅ **Postman collections** - Interactive and automated  
✅ **Swagger UI** - Beautiful documentation and testing  
✅ **Command-line tools** - Quick debugging  

Choose the right tool for your needs and combine them for comprehensive test coverage! 🚀

