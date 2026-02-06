# @codeforamerica/safety-net-{{STATE}}

TypeScript API client for {{STATE_TITLE}} safety net programs with built-in runtime validation.

This package provides:
- **TypeScript types** for compile-time safety
- **Zod schemas** for runtime validation
- **Axios-based HTTP client** with automatic request/response validation
- **Domain-specific exports** for modular imports

## Installation

```bash
npm install @codeforamerica/safety-net-{{STATE}}
```

**Peer dependencies** (required):
```bash
npm install zod@^4.0.0 axios@^1.6.0
```

## Quick Start

### Basic Usage

```typescript
import { createClient } from '@codeforamerica/safety-net-{{STATE}}/users/client';
import { getUser } from '@codeforamerica/safety-net-{{STATE}}/users';

// Configure the client
const client = createClient({
  baseURL: 'https://api.example.com',
});

// Make API calls with automatic validation
const response = await getUser({
  client,
  path: { userId: 'me' },
});

if ('data' in response) {
  console.log(response.data); // TypeScript knows the exact shape
}
```

### Import Types

```typescript
import type { User } from '@codeforamerica/safety-net-{{STATE}}/users';

function processUser(user: User) {
  // Full type safety
}
```

### Search Helpers

```typescript
import { search, q } from '@codeforamerica/safety-net-{{STATE}}';

// Build complex queries
const query = search(
  q.field('status', 'approved'),
  q.greaterThan('income', 1000),
  q.contains('name', 'smith')
);
// Result: "status:approved income:>1000 name:*smith*"
```

## Available Domains

This package exports the following domains:

- `applications` - Application management
- `households` - Household information
- `incomes` - Income records
- `persons` - Person records
- `users` - User management

Each domain provides:
- SDK functions (e.g., `getUser`, `createUser`)
- TypeScript types
- Zod schemas for validation
- HTTP client configuration

## Package Structure

```
@codeforamerica/safety-net-{{STATE}}/
├── users/              # User management SDK
│   ├── index           # SDK functions + types
│   ├── client          # HTTP client utilities
│   └── zod.gen         # Zod schemas
├── persons/            # Person management SDK
├── applications/       # Applications SDK
├── households/         # Households SDK
├── incomes/            # Incomes SDK
├── search              # Query builder utilities
├── openapi/            # Original OpenAPI specs
└── json-schema/        # JSON Schema files
```

## Runtime Validation

All API calls automatically validate:
- **Request data** before sending
- **Response data** after receiving

If validation fails, Zod throws an error with details about what went wrong.

```typescript
import { getUser } from '@codeforamerica/safety-net-{{STATE}}/users';

try {
  const response = await getUser({
    client,
    path: { userId: 'invalid' }
  });
} catch (error) {
  // Zod validation error if API returns unexpected data
  console.error('Validation failed:', error);
}
```

## Advanced Usage

### Custom Axios Instance

```typescript
import axios from 'axios';
import { createClient } from '@codeforamerica/safety-net-{{STATE}}/users/client';

const customAxios = axios.create({
  timeout: 5000,
  headers: { 'X-Custom-Header': 'value' }
});

const client = createClient({
  baseURL: 'https://api.example.com',
  axios: customAxios,
});
```

### Direct Zod Schema Access

```typescript
import { zUser } from '@codeforamerica/safety-net-{{STATE}}/users/zod.gen';

// Validate data manually
const result = zUser.safeParse(unknownData);
if (result.success) {
  console.log(result.data); // Typed as User
}
```

## License

PolyForm-Noncommercial-1.0.0

## Repository

https://github.com/codeforamerica/safety-net-apis

## Support

For issues and questions, please visit:
https://github.com/codeforamerica/safety-net-apis/issues
