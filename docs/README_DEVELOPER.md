# Developer Guide

Guide for developers working on or extending the OpenAPI Tools project.

## Project Structure

### Folder Organization

```
/
├── openapi/                    # Source of truth for API definitions
│   ├── *.yaml                  # Main API specs (one per service)
│   ├── components/             # Reusable schemas and responses
│   └── examples/               # Example data for mock server and swagger ui
│
├── generated/                  # Auto-generated, some committed
│   ├── clients/zodios/         # TypeScript clients (committed)
│   ├── postman-collection.json # Test collection (committed)
│   └── mock-data/              # SQLite databases (gitignored)
│
├── src/mock-server/            # Mock server implementation
│   └── handlers/               # CRUD operation handlers
│
├── scripts/                    # CLI tools and utilities
│   ├── mock-server/            # Server management scripts
│   └── swagger/                # Documentation server
│
├── tests/                      # Test suite
└── docs/                       # Documentation
```

### How Folders Work Together

**1. `/openapi/` - Source of Truth**
- Place main API specs here (e.g., `products.yaml`)
- Use `/components/` for shared schemas, parameters, responses
- Add example data in `/examples/` for mock server seeding

**2. `/generated/` - Auto-Generated Artifacts**
- TypeScript clients generated from specs
- Postman collections with tests
- SQLite databases created from examples

**3. `/src/mock-server/` - Runtime Engine**
- Automatically discovers and serves all specs in `/openapi/`
- Generates CRUD endpoints based on your schemas
- Validates requests against your OpenAPI definitions

**4. `/scripts/` - Developer Tools**
- Validation, generation, and server management
- All scripts auto-discover specs in `/openapi/`

## Adding New APIs

### Pattern Overview

The system follows a three-file pattern for each API:

```
/openapi/
├── products.yaml           # API spec with paths and schemas
├── components/
│   └── product.yaml        # (optional) Shared schemas
└── examples/
    └── products.yaml       # Example data for mock server
```

### Step 1: Create OpenAPI Specification

**File:** `/openapi/products.yaml`

**Required Structure:**
```yaml
openapi: 3.1.0
info:
  title: Products API        # Display name
  version: 1.0.0
  
paths:
  /products:                 # Collection endpoint
    get:                     # List all
    post:                    # Create new
    
  /products/{productId}:     # Item endpoint
    get:                     # Get one
    patch:                   # Update
    delete:                  # Delete
    
components:
  schemas:
    Product:                 # Main resource schema
    ProductCreate:           # Schema for POST
    ProductUpdate:           # Schema for PATCH
    ProductList:             # List response schema
```

**Key Patterns:**

1. **Endpoints** - Use standard REST patterns:
   - Collection: `/products` (list, create)
   - Item: `/products/{id}` (get, update, delete)

2. **Schemas** - Define four schemas:
   - `Product` - Full resource (includes `id`, `createdAt`, `updatedAt`)
   - `ProductCreate` - Request body for POST (no system fields)
   - `ProductUpdate` - Request body for PATCH (all fields optional)
   - `ProductList` - List response (`items`, `total`, `limit`, `offset`)

3. **Reuse Components** - Reference shared definitions:
   ```yaml
   parameters:
     - $ref: "./components/common-parameters.yaml#/LimitParam"
   responses:
     '404':
       $ref: "./components/common-responses.yaml#/NotFound"
   ```

### Step 2: Create Example Data

**File:** `/openapi/examples/products.yaml`

**Required Structure:**
```yaml
ProductExample1:              # Name doesn't matter, but use Example1, Example2...
  id: "uuid-here"            # Must be unique UUID
  name: "Product Name"       # Your resource fields
  createdAt: "2024-01-15T10:00:00Z"  # ISO timestamp
  updatedAt: "2024-01-15T10:00:00Z"  # ISO timestamp
  
ProductExample2:              # Add 3+ examples
  id: "different-uuid"
  name: "Another Product"
  createdAt: "2024-01-16T11:00:00Z"
  updatedAt: "2024-01-16T11:00:00Z"
```

**Key Patterns:**

1. **Naming** - Use `{Resource}Example1`, `{Resource}Example2`, etc.
2. **Required Fields** - Must include `id`, `createdAt`, `updatedAt`
3. **Unique IDs** - Each example needs a unique UUID
4. **Match Schema** - Examples must validate against your main schema
5. **Realistic Data** - Use diverse, meaningful test data

### Step 3: Validate, Generate, and Test

```bash
# 1. Validate your spec and examples
npm run validate

# 2. Generate clients and Postman collection
npm run clients:generate
npm run postman:generate

# 3. Start servers (auto-creates database from examples)
npm start
# or individually:
# npm run mock:start

# 4. Test your API
curl http://localhost:1080/products
```

Your new API is now available at:
- Mock server: `http://localhost:1080/products`
- Swagger docs: `http://localhost:3000/products` (after `npm run swagger:start`)

### Testing Your New API

```bash
# List all
curl http://localhost:1080/products

# Get one (use ID from your examples)
curl http://localhost:1080/products/{example-id}

# Create
curl -X POST http://localhost:1080/products \
  -H "Content-Type: application/json" \
  -d '{"name": "New Product", "price": 99.99}'

# Update
curl -X PATCH http://localhost:1080/products/{example-id} \
  -H "Content-Type: application/json" \
  -d '{"price": 79.99}'

# Delete
curl -X DELETE http://localhost:1080/products/{example-id}
```

## OpenAPI Spec Patterns

### Resource Schemas

**Main Resource Schema** - Full object with system fields:
```yaml
Product:
  type: object
  required: [id, name, createdAt, updatedAt]
  properties:
    id: {type: string, format: uuid}
    name: {type: string}
    createdAt: {type: string, format: date-time}
    updatedAt: {type: string, format: date-time}
```

**Create Schema** - No system fields, only required business fields:
```yaml
ProductCreate:
  type: object
  required: [name]  # Only business-required fields
  properties:
    name: {type: string}
    # No id, createdAt, updatedAt - system generates these
```

**Update Schema** - All fields optional:
```yaml
ProductUpdate:
  type: object
  properties:
    name: {type: string}
    # All optional - user can update any field
```

**List Schema** - Standard pagination wrapper:
```yaml
ProductList:
  type: object
  required: [items, total, limit, offset]
  properties:
    items:
      type: array
      items: {$ref: "#/components/schemas/Product"}
    total: {type: integer}
    limit: {type: integer}
    offset: {type: integer}
    hasNext: {type: boolean}
```

### Endpoint Patterns

**Collection Endpoints** - `/products`
```yaml
/products:
  get:
    parameters:
      - $ref: "./components/common-parameters.yaml#/LimitParam"
      - $ref: "./components/common-parameters.yaml#/OffsetParam"
    responses:
      '200':
        schema: {$ref: "#/components/schemas/ProductList"}
  
  post:
    requestBody:
      schema: {$ref: "#/components/schemas/ProductCreate"}
    responses:
      '201':
        schema: {$ref: "#/components/schemas/Product"}
```

**Item Endpoints** - `/products/{productId}`
```yaml
/products/{productId}:
  parameters:
    - name: productId
      in: path
      required: true
      schema: {type: string, format: uuid}
  
  get:
    responses:
      '200':
        schema: {$ref: "#/components/schemas/Product"}
      '404':
        $ref: "./components/common-responses.yaml#/NotFound"
  
  patch:
    requestBody:
      schema: {$ref: "#/components/schemas/ProductUpdate"}
    responses:
      '200':
        schema: {$ref: "#/components/schemas/Product"}
  
  delete:
    responses:
      '204':
        description: Deleted
```

### Using Shared Components

**Reuse pagination parameters:**
```yaml
parameters:
  - $ref: "./components/common-parameters.yaml#/LimitParam"
  - $ref: "./components/common-parameters.yaml#/OffsetParam"
```

**Reuse error responses:**
```yaml
responses:
  '400':
    $ref: "./components/common-responses.yaml#/BadRequest"
  '404':
    $ref: "./components/common-responses.yaml#/NotFound"
  '422':
    $ref: "./components/common-responses.yaml#/UnprocessableEntity"
```

**Reuse common types:**
```yaml
properties:
  address:
    $ref: "./components/common.yaml#/Address"
  name:
    $ref: "./components/common.yaml#/PersonName"
```

## Development Workflow

### Making Changes to APIs

```bash
# 1. Edit spec or examples
vim openapi/products.yaml
vim openapi/examples/products.yaml

# 2. Validate
npm run validate

# 3. Regenerate (if spec changed)
npm run clients:generate
npm run postman:generate

# 4. Reset data (if examples changed)
npm run mock:reset

# 5. Test
npm test                      # Unit tests only
npm run test:integration      # Integration tests only
npm run test:all             # Both unit and integration tests

# 6. Commit (including generated files)
git add openapi/ generated/clients/ generated/postman-collection.json
git commit -m "feat: update products API"
```

### Testing Changes

```bash
# Run unit tests only (fast, no server needed)
npm test
# or explicitly
npm run test:unit

# Run integration tests only (auto-starts server if needed)
npm run test:integration

# Run all tests (unit + integration)
npm run test:all

# Manual testing with Swagger UI
npm start  # Starts both servers
# or: npm run swagger:start
```

### Debugging

**Enable verbose logging:**
```bash
DEBUG=* npm run mock:start
```

**Check database contents:**
```bash
sqlite3 generated/mock-data/products.db "SELECT * FROM products;"
```

**View OpenAPI spec processing:**
```bash
# Check if spec loads correctly
node -e "
const loader = require('./src/mock-server/openapi-loader.js');
const specs = loader.loadAllSpecs();
console.log(JSON.stringify(specs, null, 2));
"
```

## Code Style and Conventions

### OpenAPI Specs
- Use YAML format
- Place specs in `/openapi/` root (not subdirectories)
- Use external `$ref` for reusable components
- Include examples for all schemas
- Add descriptions for all endpoints and fields
- Validate specs with `npm run validate` before committing

### Example Data
- Place in `/openapi/examples/`
- Use meaningful IDs (UUIDs)
- Include all required fields
- Provide 3+ examples per resource
- Use realistic, diverse data
- Ensure examples match schemas (validated automatically)

### JavaScript Code
- Use ES modules (`import`/`export`)
- Use async/await for async operations
- Handle errors with try/catch
- Add JSDoc comments for functions
- Use descriptive variable names

### Commit Messages
Follow conventional commits:
- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `test:` - Test changes
- `refactor:` - Code refactoring
- `chore:` - Build/tooling changes

## Extending the Mock Server

### Adding Custom Handlers

Create a new handler in `src/mock-server/handlers/`:

```javascript
// src/mock-server/handlers/custom-handler.js
export function handleCustomOperation(req, res, db, schema) {
  try {
    // Your custom logic here
    const result = db.prepare('SELECT * FROM custom_table').all();
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: error.message
    });
  }
}
```

### Adding Middleware

Edit `scripts/mock-server/server.js`:

```javascript
import express from 'express';

const app = express();

// Add custom middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// Add authentication middleware
app.use('/admin/*', (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).json({
      code: 'UNAUTHORIZED',
      message: 'Authentication required'
    });
  }
  next();
});
```

## Best Practices

### OpenAPI Design
- ✅ Use consistent naming conventions
- ✅ Version your APIs (`/v1/products`)
- ✅ Include pagination on list endpoints
- ✅ Use appropriate HTTP methods and status codes
- ✅ Provide clear error messages
- ✅ Document all parameters and responses
- ✅ Validate specs regularly with `npm run validate`

### Example Data
- ✅ Use realistic data
- ✅ Include edge cases
- ✅ Maintain referential integrity (IDs that exist)
- ✅ Update examples when schemas change
- ✅ Validate examples match schemas
- ✅ Document special test cases

### Testing
- ✅ Test all CRUD operations
- ✅ Test error cases (404, 400, 422)
- ✅ Test pagination and search
- ✅ Test validation rules
- ✅ Run tests before committing

### Git Workflow
- ✅ Commit generated files after spec changes
- ✅ Review generated file diffs in PRs
- ✅ Never manually edit generated files
- ✅ Keep commits atomic and focused
- ✅ Write descriptive commit messages

## Troubleshooting

### Client Generation Fails

**Issue:** `openapi-zod-client` errors

**Solution:**
- Run `npm run validate` to check for spec errors
- Validate OpenAPI spec at [editor.swagger.io](https://editor.swagger.io)
- Check all `$ref` paths are correct
- Ensure required fields are marked as required
- Check that examples match schemas

### Mock Server Won't Start

**Issue:** Server fails to start

**Solution:**
- Check port 1080 is not in use: `lsof -i :1080`
- Verify Node version: `node --version` (should be 18+)
- Check OpenAPI specs are valid
- Review error messages in console

### Database Issues

**Issue:** Incorrect or missing data

**Solution:**
```bash
# Reset databases
npm run mock:reset

# Or manually delete and recreate
rm generated/mock-data/*.db
npm run mock:setup
```

## Generated Files

The `/generated/` directory contains files generated from OpenAPI specifications.

### Version Control Strategy

**✅ Committed to Git:**
- **`/generated/clients/zodios/*.ts`** - TypeScript API clients
  - Generated from OpenAPI specs
  - Changes only when specs change
  - Committed so developers can use immediately
  - Reviewable in PRs to see API changes

- **`/generated/postman-collection.json`** - Postman test collection
  - Generated from specs and examples
  - Committed for immediate use
  - Shows API evolution in git history

**❌ Ignored in Git:**
- **`/generated/mock-data/*.db`** - SQLite databases
  - Runtime data that varies by environment
  - Regenerated with `npm run mock:reset`
  - Different copies for dev, test, CI

### When to Regenerate

**Zodios Clients** - Regenerate when:
- ✅ Adding/modifying API endpoints
- ✅ Changing request/response schemas
- ✅ Updating parameters or headers

**Postman Collection** - Regenerate when:
- ✅ Adding/modifying API endpoints
- ✅ Changing examples in `/openapi/examples/`
- ✅ Updating request/response formats

**Databases** - Regenerate when:
- ✅ Adding/modifying examples
- ✅ Needing fresh test data
- ✅ After corrupting local data

### Regeneration Commands

```bash
# Regenerate Zodios clients
npm run clients:generate

# Regenerate Postman collection
npm run postman:generate

# Regenerate databases
npm run mock:reset

# Regenerate everything
npm run clients:generate && npm run postman:generate && npm run mock:reset
```

### Workflow After Updating Specs

```bash
# 1. Validate changes
npm run validate

# 2. Regenerate clients and collection
npm run clients:generate
npm run postman:generate

# 3. Review changes
git diff generated/

# 4. Commit the changes
git add generated/clients/ generated/postman-collection.json
git commit -m "feat: update API for new endpoints"
```

### Best Practices for Generated Files

1. ✅ **Commit generated clients and Postman collection** after OpenAPI changes
2. ✅ **Review generated file diffs** in PRs to verify API changes
3. ✅ **Never manually edit** generated files (changes will be overwritten)
4. ✅ **Run `npm run mock:reset`** if databases become inconsistent
5. ✅ **Validate before generating** with `npm run validate`

### Handling Merge Conflicts

If you encounter merge conflicts in generated files:

```bash
# Take either version, then regenerate
git checkout --ours generated/clients/
npm run clients:generate

# Or take theirs and regenerate
git checkout --theirs generated/clients/
npm run clients:generate
```

---

For more information:
- [Validation Guide](./README_VALIDATION.md)
- [Installation Guide](./README_INSTALLATION.md)
- [Testing Guide](./README_TESTING.md)
- [Mock Server Guide](./README_MOCK_SERVER.md)


