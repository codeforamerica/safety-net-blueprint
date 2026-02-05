# @codeforamerica/safety-net-apis-{{STATE}}

State-specific Safety Net API client with TypeScript types and Zod validation schemas.

This package is generated from the [safety-net-openapi](https://github.com/codeforamerica/safety-net-openapi) repository and contains TypeScript types, Zod validation schemas, and API clients for the {{STATE_TITLE}} implementation of the Safety Net APIs.

---

## Overview

The `@codeforamerica/safety-net-apis-{{STATE}}` package provides:

* **Domain-specific TypeScript types** – Modular type definitions for all API resources
* **Zod validation schemas** – Runtime validation for requests and responses
* **Generated API clients** – Type-safe HTTP clients using Axios
* **OpenAPI specifications** – Complete API definitions for {{STATE_TITLE}}
* **JSON schemas** – Standalone JSON Schema files for each data model
* **Search helpers** – Query string builder utilities for complex searches

The APIs are designed to support eligibility, applications, and benefits use cases using a shared, multi-state data model with state-specific variations.

---

## Installation

```bash
npm install @codeforamerica/safety-net-apis-{{STATE}} axios zod
```

**Peer Dependencies:**
- `axios` ^1.6.0 – HTTP client
- `zod` ^4.0.0 – Runtime validation

---

## Package Contents

```
@codeforamerica/safety-net-apis-{{STATE}}/
├── dist/              # Compiled JavaScript + TypeScript declarations
│   ├── applications/  # Applications API domain
│   ├── persons/       # Persons API domain
│   ├── users/         # Users API domain
│   ├── households/    # Households API domain
│   ├── incomes/       # Incomes API domain
│   └── search-helpers.js
├── openapi/           # Resolved OpenAPI 3.1 specifications
│   ├── applications.yaml
│   ├── persons.yaml
│   └── ...
└── json-schema/       # Standalone JSON Schema files
    ├── applications/
    ├── persons/
    └── ...
```

---

## Usage

### Importing Types and Schemas

Each domain exports TypeScript types, Zod schemas, and API clients:

```typescript
// Import TypeScript types (compile-time only)
import type { Person, PersonCreate } from '@codeforamerica/safety-net-apis-{{STATE}}/persons';

// Import Zod schemas for runtime validation
import { PersonSchema, PersonCreateSchema } from '@codeforamerica/safety-net-apis-{{STATE}}/persons';

// Import API client
import { PersonsApi, Configuration } from '@codeforamerica/safety-net-apis-{{STATE}}/persons';
```

**Available domains:**
- `applications` – Application management
- `persons` – Person records
- `users` – User accounts and authentication
- `households` – Household composition
- `incomes` – Income sources and verification

---

### Using the API Client

#### Configuration

```typescript
import { Configuration, PersonsApi } from '@codeforamerica/safety-net-apis-{{STATE}}/persons';

const config = new Configuration({
  basePath: process.env.API_BASE_URL || 'http://localhost:1080',
  // Optional: Add authentication
  apiKey: process.env.API_KEY,
  // Optional: Custom headers
  baseOptions: {
    headers: {
      'X-Custom-Header': 'value'
    }
  }
});

const personsApi = new PersonsApi(config);
```

#### Creating a Person

```typescript
import { PersonsApi } from '@codeforamerica/safety-net-apis-{{STATE}}/persons';
import { PersonCreateSchema } from '@codeforamerica/safety-net-apis-{{STATE}}/persons';

const personsApi = new PersonsApi();

// Validate input before sending
const personData = PersonCreateSchema.parse({
  firstName: 'Jane',
  lastName: 'Doe',
  dateOfBirth: '1990-01-15',
  ssn: '123-45-6789'
});

const response = await personsApi.createPerson(personData);
console.log('Created person:', response.data);
```

#### Listing and Searching

```typescript
import { ApplicationsApi } from '@codeforamerica/safety-net-apis-{{STATE}}/applications';
import { q, search } from '@codeforamerica/safety-net-apis-{{STATE}}';

const applicationsApi = new ApplicationsApi();

// Simple list
const response = await applicationsApi.listApplications({
  limit: 25,
  offset: 0
});

// Search with query builder
const searchQuery = search(
  q('status:submitted'),
  q('applicant.county:Denver'),
  q('programs:SNAP')
);

const results = await applicationsApi.listApplications({
  q: searchQuery,
  limit: 50
});
```

---

### Search Query Syntax

The `q` and `search` helpers build query strings for the API:

```typescript
import { q, search } from '@codeforamerica/safety-net-apis-{{STATE}}';

// Field match
q('status:submitted')          // status equals "submitted"

// Greater than / less than
q('income:>50000')             // income greater than 50000
q('age:<65')                   // age less than 65

// Multiple values (OR)
q('status:submitted,approved') // status is submitted OR approved

// Field exists
q('email:*')                   // has an email field

// NOT / exclude
q('-status:denied')            // status is NOT denied

// Combine multiple conditions (AND)
search(
  q('status:submitted'),
  q('county:Denver'),
  q('income:<30000')
)
```

---

### Runtime Validation with Zod

Validate API responses or user input:

```typescript
import { PersonSchema } from '@codeforamerica/safety-net-apis-{{STATE}}/persons';

// Validate unknown data
function processPerson(data: unknown) {
  const person = PersonSchema.parse(data); // Throws if invalid
  console.log(`Processing: ${person.firstName} ${person.lastName}`);
}

// Safe parsing (doesn't throw)
const result = PersonSchema.safeParse(userData);
if (result.success) {
  console.log('Valid person:', result.data);
} else {
  console.error('Validation errors:', result.error.errors);
}

// Type inference from schemas
import { z } from 'zod';
type PersonFromZod = z.infer<typeof PersonSchema>;
```

---

### Frontend Usage (React Example)

```tsx
import { useEffect, useState } from 'react';
import { ApplicationsApi, type Application } from '@codeforamerica/safety-net-apis-{{STATE}}/applications';

const api = new ApplicationsApi({
  basePath: import.meta.env.VITE_API_BASE_URL
});

export function ApplicationList() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadApplications() {
      try {
        const response = await api.listApplications({ limit: 20 });
        setApplications(response.data.items);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    }

    loadApplications();
  }, []);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <ul>
      {applications.map((app) => (
        <li key={app.id}>
          Application #{app.id} - {app.status}
        </li>
      ))}
    </ul>
  );
}
```

---

### Error Handling

API clients throw errors for HTTP failures. Handle them using try/catch:

```typescript
import { ApplicationsApi } from '@codeforamerica/safety-net-apis-{{STATE}}/applications';

const api = new ApplicationsApi();

try {
  const response = await api.createApplication(applicationData);
  console.log('Created:', response.data);
} catch (error) {
  if (error.response) {
    // HTTP error response
    console.error('Status:', error.response.status);
    console.error('Data:', error.response.data);
  } else {
    // Network or other error
    console.error('Error:', error.message);
  }
}
```

---

## TypeScript Configuration

For best results, use these TypeScript compiler options:

```json
{
  "compilerOptions": {
    "moduleResolution": "bundler",
    "target": "ES2020",
    "module": "ESNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

---

## Versioning and Compatibility

* Package versions follow [semantic versioning](https://semver.org/)
* **Breaking changes** may occur when the underlying OpenAPI spec changes
* **Minor updates** add new fields or endpoints (backward compatible)
* **Patch updates** fix bugs or documentation

Always review the changelog when upgrading between versions.

---

## Development and Testing

### Local Mock Server

The main repository includes a mock server for development:

```bash
git clone https://github.com/codeforamerica/safety-net-openapi
cd safety-net-openapi
npm install
STATE={{STATE}} npm start
```

This launches:
- Mock API server at http://localhost:1080
- Swagger UI for interactive documentation

### Using OpenAPI Specs

The resolved OpenAPI specifications are included in `openapi/`:

```typescript
import spec from '@codeforamerica/safety-net-apis-{{STATE}}/openapi/persons.yaml';
```

Use these for:
- Generating additional clients in other languages
- API documentation tools (Redoc, Stoplight)
- Contract testing with tools like Dredd or Portman

---

## Contributing

Contributions should be made to the main [safety-net-openapi](https://github.com/codeforamerica/safety-net-openapi) repository.

**Workflow:**
1. Update the OpenAPI specification or state overlay
2. Validate the spec: `npm run validate:state`
3. Regenerate the package: `npm run clients:build-package --state={{STATE}} --version=x.y.z`
4. Test the generated package
5. Submit a pull request

---

## License

This package is part of the Safety Net OpenAPI project.

See the main repository for license details.

---

## Support

For questions, issues, or feature requests:

* **Documentation**: https://github.com/codeforamerica/safety-net-openapi
* **Issues**: https://github.com/codeforamerica/safety-net-openapi/issues
* **Discussions**: https://github.com/codeforamerica/safety-net-openapi/discussions

When reporting issues, include:
- Package version
- State ({{STATE}})
- API domain and endpoint
- Expected vs. actual behavior
