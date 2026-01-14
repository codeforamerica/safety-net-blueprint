# ADR: Migration from Zodios to @hey-api/openapi-ts

**Status:** Accepted

**Date:** 2026-01-14

**Deciders:** Development Team

---

## Context

The Safety Net OpenAPI toolkit generates TypeScript clients for consuming the API. These clients have three distinct validation and type-safety requirements:

1. **Request validation** — Validate payloads before sending API requests
2. **Response validation** — Validate API responses at runtime
3. **Static type safety** — TypeScript types for IDE autocomplete, refactoring, and compile-time error detection

Previously, we used `openapi-zod-client` to generate Zodios clients. This approach had limitations in maintainability and the separation of concerns between runtime validation and static typing.

### Requirements

- Generate TypeScript types from OpenAPI specs for compile-time safety
- Generate Zod schemas for runtime validation of both requests and responses
- Generate a typed HTTP client that integrates validation automatically
- Use actively maintained tooling with community support
- Support our state-specific overlay workflow

### Constraints

- Must work with OpenAPI 3.1 specifications
- Must integrate with existing build pipeline (`build-state-package.js`)
- Generated code should work with Zod 4.x (latest)

---

## Decision

Replace `openapi-zod-client` (Zodios) with **@hey-api/openapi-ts** for client generation.

### How It Works

`@hey-api/openapi-ts` uses a plugin architecture to generate different outputs from OpenAPI specs:

```javascript
// openapi-ts.config.js
export default {
  input: './bundled-spec.yaml',
  output: './src/persons',
  plugins: [
    '@hey-api/typescript',     // TypeScript types
    '@hey-api/sdk',            // HTTP client with typed methods
    {
      name: '@hey-api/zod',    // Zod schemas for validation
      metadata: true,
    },
    {
      name: '@hey-api/client-axios',  // Axios-based HTTP adapter
    },
  ],
};
```

### Generated Output Structure

```
src/persons/
├── index.ts           # Re-exports SDK functions and types
├── types.gen.ts       # TypeScript interfaces (Person, PersonCreate, etc.)
├── zod.gen.ts         # Zod schemas (zPerson, zPersonCreate, etc.)
├── sdk.gen.ts         # Typed SDK functions (getPerson, createPerson, etc.)
├── client.gen.ts      # Default client instance
└── client/
    ├── index.ts       # Client exports (createClient, createConfig)
    ├── client.gen.ts  # Axios client implementation
    └── utils.gen.ts   # Request/response utilities
```

---

## Three Validation Needs

### 1. Request Validation (Before API Calls)

The SDK validates request payloads before sending them to the API:

```typescript
// sdk.gen.ts (generated)
export const createPerson = (options) => client.post({
  requestValidator: async (data) => await zCreatePersonData.parseAsync(data),
  url: '/persons',
  ...options,
});
```

**Benefit:** Invalid requests fail fast with clear Zod error messages before any network call.

### 2. Response Validation (After API Calls)

The SDK validates API responses using generated Zod schemas:

```typescript
// sdk.gen.ts (generated)
export const getPerson = (options) => client.get({
  responseValidator: async (data) => await zGetPersonResponse.parseAsync(data),
  url: '/persons/{personId}',
  ...options,
});
```

**Benefit:** Catches API contract violations at runtime. If the backend returns unexpected data, the client fails with a clear validation error rather than silently accepting malformed data.

### 3. Static Type Safety (Development Experience)

TypeScript types are generated separately from Zod schemas:

```typescript
// types.gen.ts (generated)
export interface Person {
  id: string;
  name: {
    firstName: string;
    lastName: string;
    middleInitial?: string;
  };
  email: string;
  dateOfBirth?: string;
  // ... full type definition
}
```

**Benefit:** IDE autocomplete, refactoring support, and compile-time error detection—without the runtime overhead of Zod in type-only contexts.

### Separation of Concerns

| Need | Generated File | Runtime Cost | Use Case |
|------|---------------|--------------|----------|
| Request validation | `zod.gen.ts` | Yes (Zod parse) | SDK internal validation |
| Response validation | `zod.gen.ts` | Yes (Zod parse) | SDK internal validation |
| Static types | `types.gen.ts` | None | IDE, compilation, type imports |

Consumers can import types without pulling in Zod:

```typescript
// Type-only import — no runtime Zod dependency
import type { Person } from '@codeforamerica/safety-net-<your-state>/persons';

// Runtime import — includes Zod schemas
import { zPerson } from '@codeforamerica/safety-net-<your-state>/persons/zod.gen';
```

---

## Options Considered

### Option 1: openapi-zod-client / Zodios (Previous)

```typescript
// Zodios pattern - types derived from Zod schemas
const api = new Zodios(baseUrl, [
  {
    method: 'get',
    path: '/persons/:id',
    response: PersonSchema,  // Zod schema doubles as type
  },
]);
```

| Pros | Cons |
|------|------|
| Single source of truth (Zod = types) | Types always carry Zod overhead |
| Mature pattern | **Zodios is unmaintained** (no releases in 12+ months) |
| Works well for small APIs | Complex Zod schemas cause TS7056 errors |

**Rejected because:** Zodios is effectively abandoned. Snyk classifies `@zodios/core` as "Inactive" with no npm releases since early 2024. GitHub discussions from 2024-2025 remain unanswered.

---

### Option 2: openapi-typescript (asteasolutions)

```typescript
// Generates types only, no runtime validation
import type { paths } from './schema';
type Person = paths['/persons/{id}']['get']['responses']['200']['content']['application/json'];
```

| Pros | Cons |
|------|------|
| Very lightweight | No Zod schemas generated |
| Fast generation | No runtime validation |
| Active maintenance | Awkward path-based type access |

**Rejected because:** We need runtime validation. Manual Zod schema writing defeats the purpose of code generation.

---

### Option 3: @hey-api/openapi-ts (CHOSEN)

| Pros | Cons |
|------|------|
| Actively maintained | Plugin configuration complexity |
| Separate types and Zod schemas | Generated client has some TS warnings |
| Used by Vercel, PayPal | Newer project (less history) |
| 20+ plugins available | |
| Request + response validation built-in | |

**Accepted because:** Best balance of features, maintenance, and architecture. The plugin system cleanly separates types from validation schemas.

---

### Option 4: Hand-written Zod + Types

Manually write Zod schemas and derive types with `z.infer<>`.

| Pros | Cons |
|------|------|
| Full control | Defeats purpose of OpenAPI-first |
| No generator bugs | Schema drift from OpenAPI |
| | High maintenance burden |

**Rejected because:** We have 4 domain APIs with complex schemas. Manual maintenance is not sustainable.

---

## Maintenance Comparison

| Library | GitHub Stars | Last Release | Maintenance Status | Notable Users |
|---------|-------------|--------------|-------------------|---------------|
| `@hey-api/openapi-ts` | ~3,800 | Active (2025) | Actively maintained | Vercel, PayPal |
| `@zodios/core` | ~1,700 | Early 2024 | **Inactive** (Snyk) | — |
| `openapi-zod-client` | ~800 | Sporadic | Low activity | — |

The @hey-api/openapi-ts project:
- Has 289+ forks and active issue triage
- Is sponsor-funded with a public roadmap
- Started as a fork specifically to provide better maintenance

---

## Implementation

### Build Script Changes

`packages/clients/scripts/build-state-package.js` now:

1. Bundles each domain spec with `@apidevtools/swagger-cli --dereference`
2. Generates clients per domain using `@hey-api/openapi-ts`
3. Creates domain-specific exports (`./persons`, `./applications`, etc.)

### Package Exports

```json
{
  "exports": {
    ".": { "import": "./dist/index.js" },
    "./persons": { "import": "./dist/persons/index.js" },
    "./persons/client": { "import": "./dist/persons/client/index.js" },
    "./persons/*": { "import": "./dist/persons/*.js" }
  }
}
```

### Consumer Usage

```typescript
// Import SDK functions (includes validation)
import { listPersons, getPerson, createPerson } from '@codeforamerica/safety-net-<your-state>/persons';

// Import client configuration
import { createClient, createConfig } from '@codeforamerica/safety-net-<your-state>/persons/client';

// Configure client with custom base URL
const client = createClient(createConfig({ baseURL: 'http://localhost:1080' }));

// Use SDK with custom client
const response = await getPerson({ path: { personId: '123' }, client });
```

---

## Consequences

### Positive

- **Maintained tooling** — Active development and community support
- **Clean separation** — Types for DX, Zod for runtime, SDK for HTTP
- **Automatic validation** — Request/response validation without manual code
- **Better error messages** — Zod errors are descriptive and actionable
- **Future-proof** — Plugin architecture allows adding TanStack Query, etc.

### Negative

- **Generated code warnings** — Some TS errors in `client.gen.ts` (suppressed with `noEmitOnError: false`)
- **Larger output** — Separate type and Zod files vs. combined
- **Migration effort** — Consumers must update import paths

### Mitigations

1. **TS warnings** — Build script continues despite warnings; runtime code works correctly
2. **Import paths** — Package exports provide clean public API
3. **Documentation** — Update CLAUDE.md with new patterns

---

## References

- [@hey-api/openapi-ts GitHub](https://github.com/hey-api/openapi-ts)
- [Hey API Documentation](https://heyapi.dev/)
- [Snyk: @zodios/core Package Health](https://snyk.io/advisor/npm-package/@zodios/core)
- [Zodios GitHub Discussions](https://github.com/ecyrbe/zodios/discussions)
