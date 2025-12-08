# API Client Generator

Automatically generate type-safe Zodios API clients from OpenAPI specifications.

## Overview

Generates type-safe Zodios API clients from OpenAPI specifications using `openapi-zod-client`, with full type safety, request/response validation, and automatic Zod schema generation.

**Features:**
- ✅ Full TypeScript type safety
- ✅ Automatic Zod schema generation
- ✅ Request/response validation
- ✅ All endpoints from your OpenAPI spec

**Example:**
```typescript
import { personsClient } from './src/clients/persons';

const persons = await personsClient.listPersons({ limit: 10 });
```

## Dependencies

### Dev Dependencies

- `openapi-zod-client`: ^1.18.2 - Generates type-safe API clients from OpenAPI specs

## Quick Start

```bash
# Generate clients from your OpenAPI specs
npm run clients:generate

# Output: src/clients/persons.ts, households.ts, applications.ts
```

Use in your TypeScript code:
```typescript
import { personsClient } from './src/clients/persons';

const persons = await personsClient.listPersons();
```

## How It Works

The generator:
1. Scans the `/openapi` directory for OpenAPI specification files (`.yaml`, `.yml`, `.json`)
2. Generates a corresponding TypeScript Zodios client for each specification
3. Saves the generated clients to `/src/clients/` with the same base name as the spec file

**Example:**
- Input: `/openapi/persons.yaml`
- Output: `/src/clients/persons.ts`

**Note:** The generator only processes files in the root of the `/openapi` directory. Subdirectories (like `/openapi/components/`) are skipped as they typically contain shared components rather than complete API specifications.

## Generated Client Features

The generated TypeScript files contain:

### Type Safety
- Full TypeScript types derived from your OpenAPI spec
- Type-safe function parameters and return values
- Compile-time validation of API calls

### Request/Response Validation
- Automatic Zod schemas for all request/response bodies
- Runtime validation of data
- Type guards for response data

### All Endpoints
- Every endpoint defined in your specification
- Proper HTTP methods (GET, POST, PUT, PATCH, DELETE)
- Query parameters, path parameters, and request bodies
- Response types for different status codes

### Example Generated Client

```typescript
import { Zodios } from '@zodios/core';
import { z } from 'zod';

// Generated schemas
const PersonSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().email(),
  // ... more fields
});

const PersonListSchema = z.object({
  items: z.array(PersonSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number()
});

// Generated API definition
const api = [
  {
    method: 'get',
    path: '/persons',
    alias: 'listPersons',
    parameters: [
      { name: 'limit', type: 'Query', schema: z.number().optional() },
      { name: 'offset', type: 'Query', schema: z.number().optional() },
      { name: 'search', type: 'Query', schema: z.string().optional() }
    ],
    response: PersonListSchema
  },
  {
    method: 'post',
    path: '/persons',
    alias: 'createPerson',
    parameters: [
      { name: 'body', type: 'Body', schema: PersonCreateSchema }
    ],
    response: PersonSchema
  },
  // ... more endpoints
];

// Export client
export const personsClient = new Zodios('https://api.example.com', api);
```

## Using Generated Clients

### Basic Usage

```typescript
import { personsClient } from './src/clients/persons';

// List persons
const persons = await personsClient.listPersons({
  queries: { limit: 10, offset: 0 }
});

// Get a specific person
const person = await personsClient.getPerson({
  params: { personId: '123e4567-e89b-12d3-a456-426614174000' }
});

// Create a person
const newPerson = await personsClient.createPerson({
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane.doe@example.com',
  // ... more fields
});

// Update a person
const updated = await personsClient.updatePerson({
  params: { personId: '123e4567-e89b-12d3-a456-426614174000' },
  body: { monthlyIncome: 7500 }
});

// Delete a person
await personsClient.deletePerson({
  params: { personId: '123e4567-e89b-12d3-a456-426614174000' }
});
```

### With Custom Configuration

```typescript
import { Zodios } from '@zodios/core';
import { personsApi } from './src/clients/persons';

// Create client with custom configuration
const client = new Zodios('https://api.example.com', personsApi, {
  axiosConfig: {
    headers: {
      'Authorization': 'Bearer YOUR_TOKEN'
    }
  }
});

// Use the client
const persons = await client.listPersons();
```

### Error Handling

```typescript
import { ZodiosError } from '@zodios/core';

try {
  const person = await personsClient.getPerson({
    params: { personId: 'invalid-id' }
  });
} catch (error) {
  if (error instanceof ZodiosError) {
    // Validation error
    console.error('Validation failed:', error.message);
  } else {
    // HTTP error
    console.error('Request failed:', error);
  }
}
```

## Adding New API Specifications

To generate clients for a new API:

1. **Add your OpenAPI spec** to the `/openapi/` directory:
   ```bash
   /openapi/
   ├── persons.yaml        # Existing
   └── products.yaml       # New API spec
   ```

2. **Run the generator:**
   ```bash
   npm run clients:generate
   ```

3. **Use the generated client:**
   ```typescript
   import { productsClient } from './src/clients/products';
   
   const products = await productsClient.listProducts();
   ```

### OpenAPI Spec Requirements

Your OpenAPI specification should include:

- **`operationId`** for each endpoint (used for function names)
- **Schemas** for request/response bodies
- **Parameters** (path, query, header)
- **Response types** for different status codes

**Example:**

```yaml
paths:
  /persons:
    get:
      operationId: listPersons  # Required for client generation
      parameters:
        - name: limit
          in: query
          schema:
            type: integer
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PersonList'
```

## Project Structure

```
/
├── openapi/                         # OpenAPI specifications
│   ├── persons.yaml                # Example API spec
│   └── components/                 # Shared components (not processed)
│       └── schemas/
├── src/
│   └── clients/                    # Generated Zodios API clients
│       └── persons.ts             # Generated client for persons.yaml
├── scripts/
│   └── generate-clients.js        # Generation script
└── package.json                   # Dependencies and scripts
```

## Generator Script

The generation script (`scripts/generate-clients.js`) handles:

- Scanning the `/openapi` directory
- Processing each OpenAPI spec file
- Generating TypeScript clients
- Saving to `/src/clients/`

### Custom Generation Options

You can modify `scripts/generate-clients.js` to customize:

- Output directory
- File naming conventions
- Client configuration
- Template customization

## Troubleshooting

### Generation Fails

**Issue:** Generator errors on a specific OpenAPI spec

**Solutions:**
- Validate your OpenAPI spec: https://editor.swagger.io/
- Ensure all `operationId` fields are present
- Check that all `$ref` references are valid
- Verify schemas are properly defined

### Import Errors

**Issue:** Can't import generated client

**Solutions:**
- Make sure generation completed successfully
- Check that the file exists in `/src/clients/`
- Verify TypeScript configuration includes generated files
- Rebuild your TypeScript project

### Type Errors

**Issue:** TypeScript errors when using generated client

**Solutions:**
- Regenerate clients: `npm run clients:generate`
- Check OpenAPI spec matches actual API
- Ensure you're using correct parameter names
- Verify response types match API responses

## Best Practices

### 1. Version Control
```gitignore
# Don't commit generated files
src/clients/*.ts

# Do commit OpenAPI specs
openapi/*.yaml
```

### 2. CI/CD Integration
```yaml
# Example GitHub Actions
- name: Generate API Clients
  run: npm run clients:generate
  
- name: Type Check
  run: npm run type-check
```

### 3. Keep Specs Updated
- Update OpenAPI specs when API changes
- Regenerate clients after spec updates
- Test generated clients after changes

### 4. Use TypeScript
Generated clients work best with TypeScript for full type safety.

## Additional Resources

- [Zodios Documentation](https://www.zodios.org/)
- [OpenAPI Specification](https://swagger.io/specification/)
- [Zod Documentation](https://zod.dev/)
- [openapi-zod-client](https://github.com/astahmer/openapi-zod-client)

## Related Documentation

- [Mock Server Documentation](./README_MOCK_SERVER.md) - Generate mock servers from OpenAPI specs
- [Main README](../README.md) - Project overview
