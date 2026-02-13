# API Client Packages

> **Status: Draft**

Generated TypeScript SDK functions and Zod schemas for type-safe API consumption.

The `@safety-net/clients` package generates typed clients from resolved OpenAPI specs. States build client packages from their resolved specs (base + overlays) and consume them locally or publish under their own package name.

> **Note:** Client generation currently covers REST APIs (CRUD operations). As RPC endpoints are added via behavioral contracts (state machines), the generated clients will include those operations as well. See the [Frontend Developer Guide](../getting-started/frontend-developers.md) for the full API surface including RPC and event streams.

## Generating Clients

### Within this repository

```bash
# Build a state-specific client package
node packages/clients/scripts/build-state-package.js --state=<your-state> --version=1.0.0
```

This generates a complete npm package in `packages/clients/dist-packages/<your-state>/` containing:
- Typed SDK functions (`getTask`, `listApplications`, etc.)
- TypeScript interfaces
- Zod schemas for runtime validation
- Axios-based HTTP client
- Search query helpers

### In a state repository

States install `@safety-net/clients` and generate clients from their resolved specs. See the [State Setup Guide](../guides/state-setup-guide.md) for the full setup.

## Package Structure

The generated package exports domain modules:

```typescript
import { workflow, intake, persons } from './generated';
```

Each domain module provides:

| Export | Description |
|--------|-------------|
| SDK functions | `getTask`, `listTasks`, `createApplication`, etc. |
| Types | `Task`, `Application`, `ApplicationMember`, etc. |
| Client utilities | `createClient`, `createConfig` |

The root export also provides search utilities:

| Export | Description |
|--------|-------------|
| `q()` | Combines multiple search conditions into a query string |
| `search` | Object with methods like `eq()`, `contains()`, `gte()`, etc. |

### Import Paths

```typescript
// Root - namespaced access to all domains + search helpers
import { workflow, intake, q, search } from './generated';

// Domain-specific - direct imports
import { getTask, listTasks, type Task } from './generated/workflow';

// Client configuration
import { createClient, createConfig } from './generated/workflow/client';

// Zod schemas for custom validation
import { zTask, zTaskList } from './generated/workflow/zod.gen';

// Search helpers (alternative import path)
import { q, search } from './generated/search';
```

## Basic Usage

### Configure the Client

```typescript
// src/api/client.ts
import { workflow, intake } from './generated';
import { createClient, createConfig } from './generated/workflow/client';

const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:1080';

// Create a configured client
export const client = createClient(createConfig({
  baseURL: BASE_URL,
}));

// Bind SDK functions to your client
export const listTasks = (options?: Parameters<typeof workflow.listTasks>[0]) =>
  workflow.listTasks({ ...options, client });

export const getTask = (options: Parameters<typeof workflow.getTask>[0]) =>
  workflow.getTask({ ...options, client });

export const listApplications = (options?: Parameters<typeof intake.listApplications>[0]) =>
  intake.listApplications({ ...options, client });

// Re-export types
export type { Task, TaskList } from './generated/workflow';
export type { Application } from './generated/intake';
```

### Using SDK Functions

```typescript
import { getTask, listTasks, listApplications } from './api/client';

// List tasks with pagination and search
const response = await listTasks({
  query: { limit: 10, offset: 0, q: 'status:pending' }
});

if ('data' in response && response.data) {
  console.log('Tasks:', response.data.items);
}

// Get a task by ID
const taskResponse = await getTask({
  path: { taskId: '123e4567-e89b-12d3-a456-426614174000' }
});

// List applications filtered by status
const appsResponse = await listApplications({
  query: { limit: 25, q: 'status:submitted' }
});
```

### Response Handling

The SDK returns responses with automatic Zod validation. Handle responses like this:

```typescript
const response = await getTask({ path: { taskId: id } });

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
import type { Task, Application } from './generated/workflow';

function displayTask(task: Task) {
  console.log(`${task.title} — ${task.status}`);
}
```

### Zod Schemas for Custom Validation

```typescript
import { zTask } from './generated/workflow/zod.gen';

// Validate data manually
const result = zTask.safeParse(unknownData);
if (result.success) {
  console.log('Valid task:', result.data);
} else {
  console.error('Validation errors:', result.error.issues);
}

// Strict parse (throws on failure)
const task = zTask.parse(apiResponse);
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

The generated package exports `q()` and `search` utilities for type-safe query building:

```typescript
import { q, search } from './generated';
// Or from dedicated path
import { q, search } from './generated/search';
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
import { q, search } from './generated';
import { listTasks } from './api/client';

// Build a type-safe query
const query = q(
  search.eq('status', 'pending'),
  search.eq('queueId', 'snap-intake'),
  search.exists('assignedToId')
);
// Result: "status:pending queueId:snap-intake assignedToId:*"

const response = await listTasks({
  query: { q: query, limit: 25 }
});
```

### Building Queries Manually

You can also build query strings directly:

```typescript
// Multiple conditions are ANDed together
const query = 'status:pending queueId:snap-intake';

const response = await listTasks({
  query: { q: query, limit: 25 }
});
```

### Real-World Examples

```typescript
import { q, search } from './generated';

// Find pending tasks in a specific queue
const queueTasks = q(
  search.eq('status', 'pending'),
  search.eq('queueId', 'snap-intake'),
  search.notExists('assignedToId')
);

// Find applications submitted this year, excluding denied
const recentApplications = q(
  search.gte('submittedAt', '2024-01-01'),
  search.not('status', 'denied')
);

// Find tasks assigned to a specific worker
const myTasks = q(
  search.eq('assignedToId', workerId),
  search.oneOf('status', ['in_progress', 'pending'])
);
```

## With React Query

For better caching and state management:

```typescript
// src/hooks/useTasks.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listTasks, getTask } from '../api/client';
import type { Task } from '../api/client';

export function useTasks(options?: { limit?: number; offset?: number; q?: string }) {
  return useQuery({
    queryKey: ['tasks', options],
    queryFn: async () => {
      const response = await listTasks({ query: options });
      if ('data' in response && response.data) {
        return response.data;
      }
      throw new Error('Failed to fetch tasks');
    },
  });
}

export function useTask(taskId: string) {
  return useQuery({
    queryKey: ['tasks', taskId],
    queryFn: async () => {
      const response = await getTask({ path: { taskId } });
      if ('data' in response && response.data) {
        return response.data;
      }
      throw new Error('Failed to fetch task');
    },
    enabled: !!taskId,
  });
}
```

Usage in components:

```typescript
// src/components/TaskList.tsx
import { useTasks } from '../hooks/useTasks';

export function TaskList() {
  const { data, isLoading, error } = useTasks({
    limit: 25,
    q: 'status:pending queueId:snap-intake'
  });

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <ul>
      {data?.items.map((task) => (
        <li key={task.id}>
          {task.title} — {task.status}
        </li>
      ))}
    </ul>
  );
}
```

## With Redux Toolkit

```typescript
// src/store/slices/taskSlice.ts
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { getTask, type Task } from '../../api/client';

export const fetchTask = createAsyncThunk(
  'tasks/fetchById',
  async (id: string, { rejectWithValue }) => {
    try {
      const response = await getTask({ path: { taskId: id } });
      if ('data' in response && response.data) {
        return response.data;
      }
      return rejectWithValue('Failed to fetch task');
    } catch (err) {
      return rejectWithValue(err instanceof Error ? err.message : 'Unknown error');
    }
  }
);
```

## State-Specific Fields

Each generated package includes state-specific schema fields defined by that state's overlay. These may include:

- State-specific county enums and codes
- State benefit program identifiers
- Eligibility flags for state programs
- State-specific income source types

Check your state's overlay file (in this repo: `packages/schemas/openapi/overlays/<your-state>/modifications.yaml`, or in a state repo: `overlays/modifications.yaml`) to see what customizations are applied. See [State Overlays](../guides/state-overlays.md) for overlay syntax.

## Updating Clients

When the base specs (`@safety-net/schemas`) are updated:

1. Update the dependency: `npm install @safety-net/schemas@<new-version>`
2. Re-resolve overlays: `npm run resolve`
3. Regenerate clients from the updated resolved specs
4. Check the changelog for breaking changes to schema fields or API endpoints

See [State Setup Guide — Updating base specs](../guides/state-setup-guide.md#updating-base-specs) for the full update workflow.

## Troubleshooting

**Type errors after update:**
- Schema fields may have changed
- Check for renamed or removed fields
- Run TypeScript compilation to find issues

**Runtime validation errors:**
- The SDK validates responses automatically via Zod
- Ensure your API returns data matching the expected schema
- Check for missing required fields or incorrect types
