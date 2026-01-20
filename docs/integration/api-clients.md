# API Client Packages

State-specific npm packages with typed SDK functions and Zod schemas for runtime validation.

## Installation

```bash
npm install @codeforamerica/safety-net-<your-state>

# Peer dependencies
npm install zod axios
```

## Package Structure

Each package exports domain modules:

```typescript
import { persons, applications, households, incomes } from '@codeforamerica/safety-net-<your-state>';
```

Each domain module provides:

| Export | Description |
|--------|-------------|
| SDK functions | `getPerson`, `createPerson`, `listPersons`, etc. |
| Types | `Person`, `PersonCreate`, `PersonList`, etc. |
| Client utilities | `createClient`, `createConfig` |

The root export also provides search utilities:

| Export | Description |
|--------|-------------|
| `q()` | Combines multiple search conditions into a query string |
| `search` | Object with methods like `eq()`, `contains()`, `gte()`, etc. |

### Import Paths

```typescript
// Root - namespaced access to all domains + search helpers
import { persons, applications, q, search } from '@codeforamerica/safety-net-<your-state>';

// Domain-specific - direct imports
import { getPerson, createPerson, type Person } from '@codeforamerica/safety-net-<your-state>/persons';

// Client configuration
import { createClient, createConfig } from '@codeforamerica/safety-net-<your-state>/persons/client';

// Zod schemas for custom validation
import { zPerson, zPersonList } from '@codeforamerica/safety-net-<your-state>/persons/zod.gen';

// Search helpers (alternative import path)
import { q, search } from '@codeforamerica/safety-net-<your-state>/search';
```

## Basic Usage

### Configure the Client

```typescript
// src/api/client.ts
import { persons, applications, households } from '@codeforamerica/safety-net-<your-state>';
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

export const updatePerson = (options: Parameters<typeof persons.updatePerson>[0]) =>
  persons.updatePerson({ ...options, client });

export const deletePerson = (options: Parameters<typeof persons.deletePerson>[0]) =>
  persons.deletePerson({ ...options, client });

// Re-export types
export type { Person, PersonList, PersonCreate } from '@codeforamerica/safety-net-<your-state>/persons';
```

### Using SDK Functions

```typescript
import { getPerson, listPersons, createPerson, updatePerson, deletePerson } from './api/client';

// List with pagination and search
const response = await listPersons({
  query: { limit: 10, offset: 0, q: 'status:active' }
});

if ('data' in response && response.data) {
  console.log('Persons:', response.data.items);
}

// Get by ID
const personResponse = await getPerson({
  path: { personId: '123e4567-e89b-12d3-a456-426614174000' }
});

// Create
const newPersonResponse = await createPerson({
  body: {
    name: { firstName: 'Jane', lastName: 'Doe' },
    email: 'jane@example.com',
    dateOfBirth: '1990-01-15',
    phoneNumber: '555-123-4567',
    citizenshipStatus: 'citizen',
    householdSize: 1,
    monthlyIncome: 3500
  }
});

// Update
const updatedResponse = await updatePerson({
  path: { personId: '...' },
  body: { monthlyIncome: 4000 }
});

// Delete
await deletePerson({ path: { personId: '...' } });
```

### Response Handling

The SDK returns responses with automatic Zod validation. Handle responses like this:

```typescript
const response = await getPerson({ path: { personId: id } });

if ('data' in response && response.data) {
  // Success - data is validated
  return response.data;
} else if ('error' in response) {
  // Error response from API
  console.error('API error:', response.error);
}
```

## Using Types

### Type-Only Imports (No Runtime Cost)

```typescript
import type { Person, PersonCreate, PersonList } from '@codeforamerica/safety-net-<your-state>/persons';

function displayPerson(person: Person) {
  console.log(`${person.name?.firstName} ${person.name?.lastName}`);
}
```

### Zod Schemas for Custom Validation

```typescript
import { zPerson, zPersonCreate } from '@codeforamerica/safety-net-<your-state>/persons/zod.gen';

// Validate data manually
const result = zPerson.safeParse(unknownData);
if (result.success) {
  console.log('Valid person:', result.data);
} else {
  console.error('Validation errors:', result.error.issues);
}

// Strict parse (throws on failure)
const person = zPerson.parse(apiResponse);
```

## Search Query Syntax

All list endpoints support a `q` parameter for filtering using `field:value` syntax.

### Query Syntax Reference

| Pattern | Description | Example |
|---------|-------------|---------|
| `field:value` | Exact match | `status:approved` |
| `field:*value*` | Contains (case-insensitive) | `name:*john*` |
| `field:value*` | Starts with | `name:john*` |
| `field:*value` | Ends with | `email:*@example.com` |
| `field:"value"` | Quoted value (for spaces) | `name:"john doe"` |
| `field.nested:value` | Nested field | `address.state:CA` |
| `field:>value` | Greater than | `income:>1000` |
| `field:>=value` | Greater than or equal | `income:>=1000` |
| `field:<value` | Less than | `income:<5000` |
| `field:<=value` | Less than or equal | `income:<=5000` |
| `field:val1,val2` | Match any (OR) | `status:approved,pending` |
| `-field:value` | Exclude / negate | `-status:denied` |
| `field:*` | Field exists (not null) | `email:*` |
| `-field:*` | Field does not exist | `-deletedAt:*` |

### Search Helpers

The package exports `q()` and `search` utilities for type-safe query building:

```typescript
import { q, search } from '@codeforamerica/safety-net-<your-state>';
// Or from dedicated path
import { q, search } from '@codeforamerica/safety-net-<your-state>/search';
```

**Available search methods:**

| Method | Description | Example Output |
|--------|-------------|----------------|
| `search.eq(field, value)` | Exact match | `status:active` |
| `search.contains(field, value)` | Contains (case-insensitive) | `name:*john*` |
| `search.startsWith(field, value)` | Starts with | `name:john*` |
| `search.endsWith(field, value)` | Ends with | `email:*@example.com` |
| `search.gt(field, value)` | Greater than | `income:>1000` |
| `search.gte(field, value)` | Greater than or equal | `income:>=1000` |
| `search.lt(field, value)` | Less than | `income:<5000` |
| `search.lte(field, value)` | Less than or equal | `income:<=5000` |
| `search.exists(field)` | Field is not null | `email:*` |
| `search.notExists(field)` | Field is null | `-email:*` |
| `search.oneOf(field, values)` | Match any value | `status:active,pending` |
| `search.not(field, value)` | Exclude value | `-status:denied` |

**Combining conditions with `q()`:**

```typescript
import { q, search, persons } from '@codeforamerica/safety-net-<your-state>';

// Build a type-safe query
const query = q(
  search.eq('status', 'active'),
  search.gte('monthlyIncome', 2000),
  search.contains('name.lastName', 'smith'),
  search.not('countyName', 'Denver')
);
// Result: "status:active monthlyIncome:>=2000 name.lastName:*smith* -countyName:Denver"

const response = await persons.listPersons({
  query: { q: query, limit: 25 },
  client
});
```

### Building Queries Manually

You can also build query strings directly:

```typescript
// Multiple conditions are ANDed together
const query = 'status:active monthlyIncome:>=1000 -county:Denver';

const response = await listPersons({
  query: { q: query, limit: 25 }
});
```

### Real-World Examples

```typescript
import { q, search } from '@codeforamerica/safety-net-<your-state>';

// Find active persons in a specific county with income above threshold
const eligiblePersons = q(
  search.eq('status', 'active'),
  search.eq('countyName', 'Denver'),
  search.gte('monthlyIncome', 2000),
  search.exists('email')
);

// Find applications submitted this year, excluding denied
const recentApplications = q(
  search.gte('submittedAt', '2024-01-01'),
  search.not('status', 'denied')
);

// Search for persons by partial name match
const nameSearch = q(
  search.contains('name.lastName', 'smith')
);
```

## With React Query

For better caching and state management:

```typescript
// src/hooks/usePersons.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listPersons, getPerson, createPerson, updatePerson, deletePerson } from '../api/client';
import type { Person } from '../api/client';

export function usePersons(options?: { limit?: number; offset?: number; q?: string }) {
  return useQuery({
    queryKey: ['persons', options],
    queryFn: async () => {
      const response = await listPersons({ query: options });
      if ('data' in response && response.data) {
        return response.data;
      }
      throw new Error('Failed to fetch persons');
    },
  });
}

export function usePerson(personId: string) {
  return useQuery({
    queryKey: ['persons', personId],
    queryFn: async () => {
      const response = await getPerson({ path: { personId } });
      if ('data' in response && response.data) {
        return response.data;
      }
      throw new Error('Failed to fetch person');
    },
    enabled: !!personId,
  });
}

export function useCreatePerson() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: Partial<Person>) => {
      const response = await createPerson({ body: data });
      if ('data' in response && response.data) {
        return response.data;
      }
      throw new Error('Failed to create person');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['persons'] });
    },
  });
}
```

Usage in components:

```typescript
// src/components/PersonList.tsx
import { usePersons, useDeletePerson } from '../hooks/usePersons';

export function PersonList() {
  const { data, isLoading, error } = usePersons({
    limit: 25,
    q: 'status:active email:*'
  });

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <ul>
      {data?.items.map((person) => (
        <li key={person.id}>
          {person.name?.firstName} {person.name?.lastName}
        </li>
      ))}
    </ul>
  );
}
```

## With Redux Toolkit

```typescript
// src/store/slices/personSlice.ts
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { getPerson, createPerson as createPersonApi, type Person } from '../../api/client';

export const fetchPerson = createAsyncThunk(
  'persons/fetchById',
  async (id: string, { rejectWithValue }) => {
    try {
      const response = await getPerson({ path: { personId: id } });
      if ('data' in response && response.data) {
        return response.data;
      }
      return rejectWithValue('Failed to fetch person');
    } catch (err) {
      return rejectWithValue(err instanceof Error ? err.message : 'Unknown error');
    }
  }
);

export const createPerson = createAsyncThunk(
  'persons/create',
  async (payload: Partial<Person>, { rejectWithValue }) => {
    try {
      const response = await createPersonApi({ body: payload });
      if ('data' in response && response.data) {
        return response.data;
      }
      return rejectWithValue('Failed to create person');
    } catch (err) {
      return rejectWithValue(err instanceof Error ? err.message : 'Unknown error');
    }
  }
);
```

## State-Specific Fields

Each state package includes state-specific schema fields defined by that state's overlay. These may include:

- State-specific county enums and codes
- State benefit program identifiers
- Eligibility flags for state programs
- State-specific income source types

Check your state's overlay file (`packages/schemas/openapi/overlays/<your-state>/modifications.yaml`) to see what customizations are applied.

## Updating the Package

When a new version is released:

```bash
npm update @codeforamerica/safety-net-<your-state>
```

Check the changelog for breaking changes to schema fields or API endpoints.

## Troubleshooting

**Type errors after update:**
- Schema fields may have changed
- Check for renamed or removed fields
- Run TypeScript compilation to find issues

**Runtime validation errors:**
- The SDK validates responses automatically via Zod
- Ensure your API returns data matching the expected schema
- Check for missing required fields or incorrect types
