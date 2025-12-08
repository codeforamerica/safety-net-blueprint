# Postman Collection

**Dynamically generated** Postman collection from your OpenAPI specifications. The generator automatically creates requests, test scripts, and examples based on your current API definitions.

✨ **Everything is auto-generated** - Update your OpenAPI specs, regenerate, and get a fresh collection!

**For comprehensive testing documentation:** [Testing Guide](./README_TESTING.md)

## Quick Start

```bash
# Generate collection
npm run postman:generate

# Start servers
npm start
```

**Import into Postman:**
1. Open Postman → Import → Select `generated/postman-collection.json`
2. Select any request → Click **Send**
3. View automated test results in the response panel under **Test Results** ✅

**View/edit test scripts:**
1. Select any request in the collection
2. Look for the **Scripts** tab (or **Tests** section in older versions)
3. See the auto-generated JavaScript test code
4. Customize if needed (changes are saved in Postman, not the generated file)

**Run all tests:**
1. Click collection name → **Run** (or right-click → **Run collection**)
2. Click **Run [Collection Name]** to execute all requests
3. View test results in the **Run Results** panel

## What You Get

The generator scans your OpenAPI specs and automatically creates:

✅ **Requests for every endpoint** defined in your specs  
✅ **Automated test scripts** on every request  
✅ **Real example data** loaded from your YAML example files  
✅ **Environment variables** extracted from your examples  
✅ **Multiple request variations** per endpoint (list, search, filter, create alternatives)  
✅ **Error handling tests** (404, validation errors)

**The collection reflects your current API definition** - regenerate anytime your specs change!  

## Collection Structure

The generator creates a folder for each API spec and generates requests based on your OpenAPI definitions.

### Dynamic Folder Organization

```
Model App API Collection
├── [API 1 Name from spec]
│   ├── List All [Resources]
│   ├── List [Resources] (Paginated)
│   ├── Search [Resources]
│   ├── Get [Example 1 Name]        ← One per example in examples/*.yaml
│   ├── Get [Example 2 Name]        ← Generated from your examples
│   ├── Get [Example N Name]        ← Auto-discovered
│   ├── Get Non-Existent (404)
│   ├── Create [Resource]
│   ├── Create [Resource] (Alt)     ← If multiple examples exist
│   ├── Update [Resource] - Single Field
│   ├── Update [Resource] - Nested Object
│   ├── Update [Resource] - Multiple Fields
│   └── Delete [Resource]
├── [API 2 Name from spec]
│   └── ... (same pattern, auto-generated)
└── [API N Name from spec]
    └── ... (repeats for each spec in /openapi/)
```

**Generated from your specs:**
Each `.yaml` file in `/openapi/` becomes a folder in the collection

### Auto-Generated Requests Per Endpoint Type

The generator creates different request variations based on your OpenAPI paths:

#### GET /resources (List)
- **List All** - Default pagination from spec (e.g., limit=25, offset=0)
- **List Paginated** - Custom pagination
- **Search** - If query parameters defined in spec
- **Filter** - Based on available query params

#### GET /resources/{id}
- **Get [Name]** - One request per example in `openapi/examples/*.yaml`
  - Example names extracted from your YAML files
  - Uses actual IDs from your examples
- **Get Non-Existent (404)** - Tests error handling

#### POST /resources
- **Create** - Uses first example's data structure
- **Create (Alternative)** - If multiple examples exist

#### PATCH /resources/{id}
- **Update Single Field** - Tests partial updates
- **Update Nested Object** - Tests complex object updates
- **Update Multiple Fields** - Tests multiple simultaneous updates

#### DELETE /resources/{id}
- **Delete** - Uses ID from examples

## Automated Test Scripts

The generator adds appropriate test scripts to each request based on the HTTP method and expected response. You can view these scripts in Postman:

1. Select any request
2. Click the **Scripts** tab (below the URL bar)
3. Look at the **Post-response** or **Tests** section

### Generated Test Scripts by Request Type

### GET Requests (List)
```javascript
✓ Status code is 200
✓ Response is JSON
✓ Response has required list properties (items, total, limit, offset)
✓ Items is an array
```

### GET Requests (By ID)
```javascript
✓ Status code is 200
✓ Response is JSON
✓ Response has id property
```

### POST Requests
```javascript
✓ Status code is 201
✓ Response has id and timestamps (createdAt, updatedAt)
✓ Location header is present
```

### PATCH Requests
```javascript
✓ Status code is 200
✓ Response has updatedAt timestamp
```

### DELETE Requests
```javascript
✓ Status code is 204
```

### 404 Requests
```javascript
✓ Status code is 404
✓ Error response has code and message
```

## Environment Variables

The generator automatically extracts IDs from your example files and creates collection variables:

| Variable | Source | Description |
|----------|--------|-------------|
| `baseUrl` | Default or env var | Mock server URL (default: `http://localhost:1080`) |
| `{resource}Id` | First example | ID from first example of each resource type |

**Pattern:**
- `{resourceName}Id` → First example's ID from `openapi/examples/{resourceName}.yaml`

**Dynamic:** The generator creates one variable per resource type based on your specs!

### Using Variables

Variables are referenced in requests using double curly braces:
```
GET {{baseUrl}}/persons/{{personId}}
```

### Changing Base URL

**Option 1: Before Generating**
```bash
POSTMAN_BASE_URL=https://api.example.com npm run postman:generate
```

**Option 2: In Postman**
1. Click on the collection
2. Go to **Variables** tab
3. Change `baseUrl` value
4. Save

## Request Examples

Generic examples showing the patterns used in generated requests. Replace `{resource}` with your actual resource name (e.g., users, products, orders).

### Example 1: List Resources with Pagination

**Request:**
```
GET {{baseUrl}}/{resources}?limit=2&offset=0
```

**Tests Run:**
- ✓ Status code is 200
- ✓ Response is JSON
- ✓ Response has items, total, limit, offset
- ✓ Items is an array

**Expected Response:**
```json
{
  "items": [
    { "id": "...", ... },
    { "id": "...", ... }
  ],
  "total": 10,
  "limit": 2,
  "offset": 0,
  "hasNext": true
}
```

### Example 2: Search Resources

**Request:**
```
GET {{baseUrl}}/{resources}?search=query&limit=10
```

**Tests Run:**
- ✓ Status code is 200
- ✓ Response has required list properties

**Expected Response:**
```json
{
  "items": [
    { "id": "...", ... }
  ],
  "total": 1,
  "limit": 10,
  "offset": 0,
  "hasNext": false
}
```

### Example 3: Create Resource

**Request:**
```
POST {{baseUrl}}/{resources}
Content-Type: application/json

{
  "field1": "value1",
  "field2": "value2",
  ...
}
```

**Tests Run:**
- ✓ Status code is 201
- ✓ Response has id and timestamps
- ✓ Location header is present

**Expected Response:**
```json
{
  "id": "newly-generated-uuid",
  "field1": "value1",
  "field2": "value2",
  "createdAt": "2024-12-05T20:00:00Z",
  "updatedAt": "2024-12-05T20:00:00Z",
  ...
}
```

### Example 4: Update Resource - Single Field

**Request:**
```
PATCH {{baseUrl}}/{resources}/{{resourceId}}
Content-Type: application/json

{
  "field1": "new-value"
}
```

**Tests Run:**
- ✓ Status code is 200
- ✓ Response has updatedAt timestamp

**Expected Response:**
```json
{
  "id": "{{resourceId}}",
  "field1": "new-value",
  "updatedAt": "2024-12-05T20:05:00Z",
  ... (other fields unchanged)
}
```

### Example 5: Test 404 Error

**Request:**
```
GET {{baseUrl}}/{resources}/00000000-0000-0000-0000-000000000000
```

**Tests Run:**
- ✓ Status code is 404
- ✓ Error response has code and message

**Expected Response:**
```json
{
  "code": "NOT_FOUND",
  "message": "{Resource} not found"
}
```

## Advanced Usage

### Running Against Different Environments

Create Postman environments for different servers:

**Development Environment:**
```json
{
  "name": "Development",
  "values": [
    { "key": "baseUrl", "value": "http://localhost:1080" }
  ]
}
```

**Staging Environment:**
```json
{
  "name": "Staging",
  "values": [
    { "key": "baseUrl", "value": "https://staging-api.example.com" }
  ]
}
```

### Chaining Requests

Use test scripts to extract values and pass them to subsequent requests:

```javascript
// In POST {resource} test script
const jsonData = pm.response.json();
pm.environment.set("newResourceId", jsonData.id);

// Then use in next request
GET {{baseUrl}}/{resources}/{{newResourceId}}
```

### Custom Test Scripts

Edit any request's test script to add custom validations:

```javascript
pm.test("Field value meets criteria", function () {
    const jsonData = pm.response.json();
    pm.expect(jsonData.fieldName).to.equal("expected-value");
});
```

## Regenerating Collection

The collection is dynamically generated - regenerate anytime you change your API:

```bash
npm run postman:generate
```

**Regeneration process:**
1. ✅ Scans `/openapi/*.yaml` for all API specs
2. ✅ Discovers all endpoints and operations
3. ✅ Loads examples from `/openapi/examples/*.yaml`
4. ✅ Generates requests for each endpoint + example combination
5. ✅ Creates test scripts for each request type
6. ✅ Extracts variables from examples
7. ✅ Outputs to `generated/postman-collection.json`

**When to regenerate:**
- ✨ Added/modified an endpoint in your OpenAPI spec
- ✨ Added/changed examples in your YAML files
- ✨ Changed API structure or schemas
- ✨ Added a new API spec file
- ✨ Changed request/response formats

**Note:** Re-import the collection in Postman to see changes. Any customizations you made in Postman will be lost (test scripts, descriptions, etc.).

## Troubleshooting

### Collection not importing

**Issue:** Postman can't import the file

**Solutions:**
- Ensure file exists: `ls generated/postman-collection.json`
- Check file is valid JSON
- Try dragging file directly into Postman

### Tests failing

**Issue:** All tests show red X

**Solutions:**
- Ensure mock server is running: `npm run mock:start`
- Check base URL variable matches server URL
- Verify server is accessible: `curl http://localhost:1080/health`

### Missing examples

**Issue:** Some requests have no data

**Solutions:**
- Check example files exist: `ls openapi/examples/`
- Ensure examples have `id` fields
- Regenerate collection: `npm run postman:generate`

### Variables not working

**Issue:** `{{baseUrl}}` showing literally in requests

**Solutions:**
- Make sure you imported the collection (not just opened file)
- Check Variables tab in collection
- Set environment if needed

## Best Practices

### 1. Run Tests Regularly

Run collection tests after:
- Updating OpenAPI specs
- Changing mock server
- Modifying examples

### 2. Use Environments

Create separate environments for:
- Local development
- Staging server
- Production API

### 3. Version Control

While `generated/` is gitignored, you can commit generated collections to share with team:

```bash
cp generated/postman-collection.json postman/v1.0.0.json
git add postman/v1.0.0.json
git commit -m "Add Postman collection v1.0.0"
```

### 4. Documentation

The collection includes descriptions from OpenAPI specs. Keep your specs well-documented!

## CI/CD Integration

Run Postman tests in your CI/CD pipeline using Newman.

**Learn more:** [Testing Guide - CI/CD Integration](./README_TESTING.md#cicd-integration-with-newman)

## Customization

### Edit Generator Script

The generator script is at: `scripts/generate-postman.js`

You can customize:
- Request naming
- Test scripts
- Variables
- Request organization

## How the Generator Works

The `scripts/generate-postman.js` script:

1. **Discovers APIs** - Scans `openapi/*.yaml` files
2. **Parses specs** - Loads and validates each OpenAPI specification
3. **Loads examples** - Reads example data from `openapi/examples/*.yaml`
4. **Generates requests** - Creates Postman requests for each endpoint
5. **Adds test scripts** - Injects appropriate test code per request type
6. **Extracts variables** - Pulls IDs and values from examples
7. **Builds collection** - Assembles the complete Postman Collection v2.1 JSON
8. **Writes file** - Outputs to `generated/postman-collection.json`

## Summary

The Postman collection generator provides:

✅ **100% automatic** - No manual request creation  
✅ **Stays in sync** - Regenerate when specs change  
✅ **Dynamic** - Adapts to your API structure  
✅ **Comprehensive** - Multiple variations per endpoint  
✅ **Tested** - Automated test scripts included  
✅ **Real data** - Uses your actual examples  

**Your API changes, your collection changes!** 🚀

