# Known Limitations

## Zod schemas drop extra properties on `additionalProperties: true` objects

**Affects:** Any OpenAPI schema that combines named properties with `additionalProperties: true`

**Generator:** `@hey-api/openapi-ts` (Zod plugin)

### The problem

When an OpenAPI schema defines both explicit properties *and* `additionalProperties: true`, the generated Zod schema silently strips unrecognized properties during parsing. This happens because `@hey-api/openapi-ts` generates `z.object({...})` without `.passthrough()`.

In Zod, `z.object()` strips unknown keys by default. To preserve them, the schema needs `.passthrough()`. The generator does not add this.

### Example: `UiPermissions`

The OpenAPI spec declares `UiPermissions` as an extensible object — states add custom UI permission fields via overlays:

```yaml
# users-openapi.yaml
UiPermissions:
  type: object
  additionalProperties: true
  properties:
    availableModules:
      type: array
      items:
        type: string
        enum: [cases, tasks, reports, documents, scheduling, admin, state_integration]
    canApproveApplications:
      type: boolean
```

A state overlay might add a custom field:

```yaml
# overlays/example/modifications.yaml
actions:
  - target: $.components.schemas.UiPermissions.properties
    update:
      canExportData:
        type: boolean
        description: Whether the user can export data.
```

The generated Zod schema does **not** preserve the extra field:

```typescript
// zod.gen.ts (generated)
export const zUiPermissions = z.object({
    availableModules: z.optional(z.array(z.enum([...]))),
    canApproveApplications: z.optional(z.boolean())
}).readonly();
// Missing: .passthrough() to allow extra properties
```

### What breaks

```typescript
import { zUiPermissions } from '@codeforamerica/safety-net-example/users/zod.gen';

const permissions = {
  availableModules: ['cases', 'tasks'],
  canApproveApplications: false,
  canExportData: true,         // added by state overlay
  canViewSensitivePII: false,  // added by state overlay
};

const parsed = zUiPermissions.parse(permissions);
// parsed = { availableModules: ['cases', 'tasks'], canApproveApplications: false }
// canExportData and canViewSensitivePII are silently dropped!
```

### What works fine

The **TypeScript types** and **JSON Schema** outputs handle this correctly:

```typescript
// types.gen.ts — index signature preserves extra properties
export type UiPermissions = {
    availableModules?: Array<'cases' | 'tasks' | ...>;
    canApproveApplications?: boolean;
    [key: string]: unknown;  // additionalProperties: true
};
```

```json
// UiPermissions.json — additionalProperties preserved
{
  "type": "object",
  "additionalProperties": true,
  "properties": {
    "availableModules": { ... },
    "canApproveApplications": { ... }
  }
}
```

### Schemas without named properties are fine

When a schema has `additionalProperties: true` but no named properties (like `UserPreferences`), the generator correctly uses `z.record()`:

```typescript
// This is correct — z.record() naturally handles arbitrary keys
export const zUserPreferences = z.record(z.string(), z.unknown());
```

The issue is specifically with schemas that have **both** named properties and `additionalProperties: true`.

### Workaround

If you need Zod validation for these schemas, add `.passthrough()` after importing:

```typescript
import { zUiPermissions } from '@codeforamerica/safety-net-example/users/zod.gen';

const zUiPermissionsPassthrough = zUiPermissions.passthrough();
const parsed = zUiPermissionsPassthrough.parse(permissions);
// Now extra properties are preserved
```

### Affected schemas

Currently, only `UiPermissions` in the users domain combines named properties with `additionalProperties: true`. If future schemas follow this pattern, they will have the same limitation.

### Upstream

This is a `@hey-api/openapi-ts` code generator limitation, not a bug in our build scripts. The fix is straightforward: when generating `z.object({...})` for a schema with `additionalProperties: true`, the Zod plugin should append `.passthrough()`. The TypeScript plugin already detects this case correctly (it emits the `[key: string]: unknown` index signature), so the detection logic exists — the Zod plugin just doesn't use it.

The issue is tracked upstream as an unchecked item ("object with unknown additional properties") in [hey-api/openapi-ts#1320 (Zod plugin tasks)](https://github.com/hey-api/openapi-ts/issues/1320). This needs a PR to the `@hey-api/openapi-ts` Zod plugin to resolve properly.

See the [client generation ADR](../decisions/openapi-ts-client-generation.md) for generator context.
