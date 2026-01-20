# Getting Started: Frontend Developers

This guide is for developers building frontend applications that consume Safety Net APIs. You'll use pre-built npm packages with TypeScript SDK functions and Zod schemas.

## What You'll Do

- Install a state-specific npm package with typed SDK and Zod schemas
- Integrate into your frontend application
- Develop against the mock server while the backend is in progress
- Set up CI/CD to test your frontend

## Prerequisites

- Node.js >= 18.0.0
- A frontend project (React, Vue, etc.)
- Familiarity with TypeScript

## Initial Setup

### 1. Install the Package

```bash
npm install @codeforamerica/safety-net-<your-state>
```

### 2. Install Peer Dependencies

```bash
npm install zod axios
```

## Using the Package

### Importing SDK Functions and Types

```typescript
// Direct imports from domain modules
import {
  getPerson,
  listPersons,
  createPerson,
  type Person,
  type PersonList
} from '@codeforamerica/safety-net-<your-state>/persons';

// Or namespaced imports
import { persons, applications } from '@codeforamerica/safety-net-<your-state>';
```

### Configuring the Client

Create a client configuration file:

```typescript
// src/api/client.ts
import { persons, applications } from '@codeforamerica/safety-net-<your-state>';
import { createClient, createConfig } from '@codeforamerica/safety-net-<your-state>/persons/client';

const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:1080';

// Create a configured client
export const client = createClient(createConfig({
  baseURL: BASE_URL,
}));

// Bind SDK functions to your client
export const listPersons = (options?: Parameters<typeof persons.listPersons>[0]) =>
  persons.listPersons({ ...options, client });

export const getPerson = (options: Parameters<typeof persons.getPerson>[0]) =>
  persons.getPerson({ ...options, client });

export const createPerson = (options: Parameters<typeof persons.createPerson>[0]) =>
  persons.createPerson({ ...options, client });

// Re-export types for convenience
export type { Person, PersonList } from '@codeforamerica/safety-net-<your-state>/persons';
```

### Using in Components

```typescript
// src/components/PersonList.tsx
import { useEffect, useState } from 'react';
import { listPersons, type Person } from '../api/client';

export function PersonList() {
  const [persons, setPersons] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchPersons() {
      const response = await listPersons({ query: { limit: 25 } });
      if ('data' in response && response.data) {
        setPersons(response.data.items ?? []);
      }
      setLoading(false);
    }
    fetchPersons();
  }, []);

  if (loading) return <div>Loading...</div>;

  return (
    <ul>
      {persons.map((person) => (
        <li key={person.id}>{person.name?.firstName} {person.name?.lastName}</li>
      ))}
    </ul>
  );
}
```

### Runtime Validation with Zod

For custom validation scenarios, import Zod schemas directly:

```typescript
import { zPerson } from '@codeforamerica/safety-net-<your-state>/persons/zod.gen';

// Validate API response
const parseResult = zPerson.safeParse(apiResponse);
if (parseResult.success) {
  return parseResult.data;
} else {
  console.error('Validation failed:', parseResult.error);
}
```

## Development Workflow

### Develop Against the Mock Server

While the backend is being built, use the mock server:

```bash
# Clone the toolkit (one-time setup)
git clone https://github.com/codeforamerica/safety-net-openapi.git
cd safety-net-openapi
npm install

# Start the mock server
STATE=<your-state> npm start
```

The mock server runs at http://localhost:1080 with realistic test data.

Point your frontend at it:

```bash
# In your frontend
REACT_APP_API_URL=http://localhost:1080 npm start
```

### When the Package Updates

Simply update your package version:

```bash
npm update @codeforamerica/safety-net-<your-state>
```

## Exploring the API

### Swagger UI

Browse the API documentation interactively:

```bash
cd safety-net-openapi
STATE=<your-state> npm start
```

Visit http://localhost:3000 to see all endpoints and schemas.

### Example Requests

```bash
# List persons
curl http://localhost:1080/persons

# Search
curl "http://localhost:1080/persons?q=status:active"

# Get by ID
curl http://localhost:1080/persons/{id}
```

## Package Contents

Each state package exports domain modules:

| Module | SDK Functions |
|--------|---------------|
| `persons` | `listPersons`, `getPerson`, `createPerson`, `updatePerson`, `deletePerson` |
| `applications` | `listApplications`, `getApplication`, `createApplication`, `updateApplication`, `deleteApplication` |
| `households` | `listHouseholds`, `getHousehold`, `createHousehold`, `updateHousehold`, `deleteHousehold` |
| `incomes` | `listIncomes`, `getIncome`, `createIncome`, `updateIncome`, `deleteIncome` |

Each module also exports:
- TypeScript types (`Person`, `PersonList`, `PersonCreate`, etc.)
- Zod schemas via `./zod.gen` subpath (`zPerson`, `zPersonList`, etc.)
- Client utilities via `./client` subpath (`createClient`, `createConfig`)

### Search Helpers

The package also exports utilities for building search queries:

```typescript
import { q, search } from '@codeforamerica/safety-net-<your-state>';

const query = q(
  search.contains('name.firstName', 'john'),
  search.gte('monthlyIncome', 2000),
  search.eq('status', 'active')
);

const response = await listPersons({ query: { q: query } });
```

See [API Clients - Search Helpers](../integration/api-clients.md#search-helpers) for the full reference.

## Next Steps

- [API Clients](../integration/api-clients.md) — Detailed client usage and framework integrations
- [Mock Server](../guides/mock-server.md) — Search, pagination, and data management
- [CI/CD for Frontend](../integration/ci-cd-frontend.md) — Testing setup
