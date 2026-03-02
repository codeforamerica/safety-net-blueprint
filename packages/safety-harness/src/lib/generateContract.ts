import { z } from 'zod';
import type {
  FormContract,
  PermissionsPolicy,
  FieldDefinition,
  ComponentType,
  ActionDefinition,
  Page,
} from '@safety-net/form-engine';

// ── Schema shape coming from the dereferenced OpenAPI spec ──────────────────

interface SchemaProperty {
  type?: string;
  format?: string;
  enum?: string[];
  readOnly?: boolean;
  description?: string;
  properties?: Record<string, SchemaProperty>;
  items?: SchemaProperty;
  allOf?: SchemaProperty[];
  required?: string[];
  additionalProperties?: unknown;
  minItems?: number;
  maxItems?: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function titleCase(s: string): string {
  return s
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Resolve allOf by merging all sub-schemas into a single flat schema.
 * After dereferencing, allOf entries are plain objects (no $refs).
 */
function resolveAllOf(schema: SchemaProperty): SchemaProperty {
  if (!schema.allOf) return schema;

  const merged: SchemaProperty = { type: 'object', properties: {}, required: [] };
  for (const part of schema.allOf) {
    const resolved = resolveAllOf(part);
    if (resolved.properties) {
      merged.properties = { ...merged.properties, ...resolved.properties };
    }
    if (resolved.required) {
      merged.required = [...(merged.required ?? []), ...resolved.required];
    }
  }
  // Preserve any top-level properties declared alongside allOf
  if (schema.properties) {
    merged.properties = { ...merged.properties, ...schema.properties };
  }
  if (schema.required) {
    merged.required = [...(merged.required ?? []), ...schema.required];
  }
  return merged;
}

/** Map an OpenAPI property to a form ComponentType. */
function mapComponent(prop: SchemaProperty): ComponentType {
  if (prop.enum) return 'select';
  if (prop.type === 'boolean') return 'checkbox-group';
  if (prop.type === 'string' && (prop.format === 'date' || prop.format === 'date-time')) {
    return 'date-input';
  }
  return 'text-input';
}

/** Skip these meta/system fields — they're not user-editable. */
const SKIP_FIELDS = new Set(['additionalProperties']);

/** These fields render as read-only regardless of role. */
const READ_ONLY_FIELDS = new Set(['id', 'createdAt', 'updatedAt']);

// ── Field generation ────────────────────────────────────────────────────────

function generateFields(
  properties: Record<string, SchemaProperty>,
  prefix: string,
  readOnlyFields: Map<string, true>,
  requiredKeys: Set<string> = new Set(),
): FieldDefinition[] {
  const fields: FieldDefinition[] = [];

  for (const [key, rawProp] of Object.entries(properties)) {
    if (SKIP_FIELDS.has(key)) continue;

    const prop = resolveAllOf(rawProp);
    const ref = prefix ? `${prefix}.${key}` : key;

    if (READ_ONLY_FIELDS.has(key) || prop.readOnly) {
      readOnlyFields.set(ref, true);
    }

    // Nested object → flatten its fields with dot-path refs
    if (prop.type === 'object' && prop.properties) {
      const nested = generateFields(prop.properties, ref, readOnlyFields, new Set(prop.required ?? []));
      fields.push(...nested);
      continue;
    }

    // Array of objects → field-array
    if (prop.type === 'array' && prop.items) {
      const itemSchema = resolveAllOf(prop.items);
      if (itemSchema.type === 'object' && itemSchema.properties) {
        const subFields = generateFields(itemSchema.properties, '', readOnlyFields, new Set(itemSchema.required ?? []));
        fields.push({
          ref,
          component: 'field-array',
          fields: subFields,
          ...(prop.minItems != null ? { min_items: prop.minItems } : {}),
          ...(prop.maxItems != null ? { max_items: prop.maxItems } : {}),
        });
        continue;
      }
      // Array of primitives (e.g. race: string[]) → checkbox-group if enum, else text
      if (prop.items.enum) {
        fields.push({
          ref,
          component: 'checkbox-group',
          labels: Object.fromEntries(prop.items.enum.map((v) => [v, titleCase(v)])),
          ...(requiredKeys.has(key) ? { required: true } : {}),
        });
        continue;
      }
    }

    // Scalar field
    const field: FieldDefinition = {
      ref,
      component: mapComponent(prop),
      ...(requiredKeys.has(key) ? { required: true } : {}),
    };

    // Add labels for enum values
    if (prop.enum) {
      field.labels = Object.fromEntries(prop.enum.map((v) => [v, titleCase(v)]));
    }

    // Boolean → single checkbox with label
    if (prop.type === 'boolean') {
      field.labels = { true: titleCase(key) };
    }

    fields.push(field);
  }

  return fields;
}

// ── Main entry point ────────────────────────────────────────────────────────

import type { Role, NavigationType, DisplayType, ReferenceColumn } from '@safety-net/form-engine';

interface GenerateContractResult {
  contract: FormContract;
  permissions: Record<string, PermissionsPolicy>;
  schema: z.ZodSchema;
}

export interface EndpointInfo {
  path: string;
  method: string;
  operationId: string;
  summary: string;
}

/**
 * Generate a FormContract + per-role PermissionsPolicy from an OpenAPI schema.
 *
 * Walks the schema's properties, producing one page per top-level object
 * (e.g. "Demographic Info", "Contact Info") and a "General" page for
 * flat top-level fields. Generates resource binding and action buttons
 * from the API's discovered endpoints.
 */
export interface LayoutOverrides {
  navigation?: NavigationType;
  display?: DisplayType;
}

export function generateContract(
  apiName: string,
  apiTitle: string,
  schema: SchemaProperty,
  baseResource?: string,
  endpoints?: EndpointInfo[],
  layoutOverrides?: LayoutOverrides,
): GenerateContractResult {
  const resolved = resolveAllOf(schema);
  const properties = resolved.properties ?? {};
  const topRequired = new Set(resolved.required ?? []);
  const readOnlyFields = new Map<string, true>();

  // Partition top-level properties into "object pages" vs "general fields"
  const generalFields: FieldDefinition[] = [];
  const pages: Page[] = [];

  for (const [key, rawProp] of Object.entries(properties)) {
    if (SKIP_FIELDS.has(key)) continue;

    const prop = resolveAllOf(rawProp);

    // Top-level objects get their own page
    if (prop.type === 'object' && prop.properties) {
      const fields = generateFields(prop.properties, key, readOnlyFields, new Set(prop.required ?? []));
      if (fields.length > 0) {
        pages.push({
          id: key,
          title: titleCase(key),
          fields,
        });
      }
      continue;
    }

    // Everything else → general page
    const ref = key;

    if (READ_ONLY_FIELDS.has(key) || rawProp.readOnly) {
      readOnlyFields.set(ref, true);
    }

    // Array of objects at top level → its own page
    if (prop.type === 'array' && prop.items) {
      const itemSchema = resolveAllOf(prop.items);
      if (itemSchema.type === 'object' && itemSchema.properties) {
        const subFields = generateFields(itemSchema.properties, '', readOnlyFields, new Set(itemSchema.required ?? []));
        pages.push({
          id: key,
          title: titleCase(key),
          fields: [
            {
              ref: key,
              component: 'field-array',
              fields: subFields,
              ...(prop.minItems != null ? { min_items: prop.minItems } : {}),
              ...(prop.maxItems != null ? { max_items: prop.maxItems } : {}),
            },
          ],
        });
        continue;
      }
    }

    // Scalar / simple array → general fields
    const field: FieldDefinition = {
      ref,
      component: mapComponent(prop),
      ...(topRequired.has(key) ? { required: true } : {}),
    };
    if (prop.enum) {
      field.labels = Object.fromEntries(prop.enum.map((v) => [v, titleCase(v)]));
    }
    if (prop.type === 'boolean') {
      field.labels = { true: titleCase(key) };
    }
    if (prop.type === 'array' && prop.items?.enum) {
      field.component = 'checkbox-group';
      field.labels = Object.fromEntries(prop.items.enum.map((v) => [v, titleCase(v)]));
    }
    generalFields.push(field);
  }

  // Insert "General" page at the beginning if there are flat fields
  if (generalFields.length > 0) {
    pages.unshift({
      id: 'general',
      title: 'General',
      fields: generalFields,
    });
  }

  // Build actions from discovered endpoints
  const actions: ActionDefinition[] = [];
  if (endpoints) {
    // Find the identity param name from the GET-by-id endpoint path, e.g. /persons/{personId}
    const detailEndpoint = endpoints.find(
      (e) => e.method === 'GET' && e.path.includes('{'),
    );
    const identityParam = detailEndpoint?.path.match(/\{(\w+)\}/)?.[1];

    for (const ep of endpoints) {
      const method = ep.method.toUpperCase() as ActionDefinition['method'];
      const isCollection = !ep.path.includes('{');

      if (method === 'GET') continue; // GETs are not actions

      if (method === 'POST' && isCollection) {
        actions.push({
          id: ep.operationId ?? 'create',
          label: 'Create',
          method: 'POST',
          style: 'default',
          navigate: baseResource ? `${baseResource}/{id}` : undefined,
        });
      } else if (method === 'PATCH' || method === 'PUT') {
        actions.push({
          id: ep.operationId ?? 'update',
          label: 'Save',
          method,
          style: 'default',
        });
      } else if (method === 'DELETE') {
        actions.push({
          id: ep.operationId ?? 'delete',
          label: 'Delete',
          method: 'DELETE',
          style: 'warning',
          confirm: `Are you sure you want to delete this ${apiName.replace(/-/g, ' ')}?`,
          navigate: baseResource,
        });
      } else {
        // Non-CRUD endpoint (future behavioral/RPC actions)
        actions.push({
          id: ep.operationId ?? ep.path,
          label: titleCase(ep.operationId ?? ep.summary ?? method),
          method,
          endpoint: ep.path,
          style: 'secondary',
        });
      }
    }
  }

  // Build the contract
  const contract: FormContract = {
    form: {
      id: `${apiName}-detail`,
      title: apiTitle,
      schema: apiName,
      layout: {
        navigation: layoutOverrides?.navigation ?? 'in-page',
        display: layoutOverrides?.display ?? 'scrollable',
      },
      ...(baseResource ? {
        resource: {
          endpoint: baseResource,
          ...(endpoints?.find((e) => e.path.includes('{'))?.path.match(/\{(\w+)\}/)?.[1]
            ? { identity: endpoints.find((e) => e.path.includes('{'))!.path.match(/\{(\w+)\}/)![1] }
            : {}),
        },
      } : {}),
      ...(actions.length > 0 ? { actions } : {}),
      pages,
    },
  };

  // Build per-role permissions policies
  const readOnlyFieldOverrides: Record<string, 'read-only'> = {};
  for (const ref of readOnlyFields.keys()) {
    readOnlyFieldOverrides[ref] = 'read-only';
  }

  const roles: Role[] = ['admin', 'applicant', 'caseworker', 'reviewer'];
  const permissions: Record<string, PermissionsPolicy> = {};
  for (const role of roles) {
    permissions[role] = {
      role,
      defaults: role === 'reviewer' ? 'read-only' : 'editable',
      fields: readOnlyFieldOverrides,
    };
  }

  // Permissive passthrough schema — validation is not the goal of explore mode
  const zodSchema = z.record(z.string(), z.unknown());

  return { contract, permissions, schema: zodSchema };
}

// ── List contract generation ────────────────────────────────────────────────

/**
 * Derive columns from an OpenAPI schema's top-level properties.
 * Skips objects, arrays, and date-time fields — same heuristic as the
 * old hand-rolled `deriveColumns()` in ApiListPage.
 */
function deriveListColumns(
  schema: SchemaProperty | undefined,
  maxColumns = 5,
): ReferenceColumn[] {
  if (!schema) return [{ from: 'id', label: 'ID' }];

  const resolved = resolveAllOf(schema);
  const props = resolved.properties;
  if (!props) return [{ from: 'id', label: 'ID' }];

  const columns: ReferenceColumn[] = [];
  for (const key of Object.keys(props)) {
    const prop = resolveAllOf(props[key]);
    if (prop.type === 'object' || prop.type === 'array') continue;
    if (prop.format === 'date-time') continue;
    columns.push({ from: key, label: titleCase(key) });
    if (columns.length >= maxColumns) break;
  }
  return columns.length > 0 ? columns : [{ from: 'id', label: 'ID' }];
}

/**
 * Generate a data-table list contract from an OpenAPI resource schema.
 * Returns a FormContract with a single page using `display: 'data-table'`
 * and `source: 'api'`, along with column definitions and an optional
 * detail block that references the detail form.
 */
export function generateListContract(
  apiName: string,
  apiTitle: string,
  schema: SchemaProperty | undefined,
  detailFormId?: string,
  detailFetchTemplate?: string,
): { contract: FormContract; columns: ReferenceColumn[] } {
  const columns = deriveListColumns(schema);

  const listPage: Page = {
    id: 'list',
    title: apiTitle,
    display: 'data-table',
    source: 'api',
    columns,
    ...(detailFormId && detailFetchTemplate
      ? { detail: { form: detailFormId, fetch: detailFetchTemplate } }
      : {}),
  };

  const contract: FormContract = {
    form: {
      id: `${apiName}-list`,
      title: apiTitle,
      schema: apiName,
      layout: { navigation: 'none', display: 'data-table' },
      pages: [listPage],
    },
  };

  return { contract, columns };
}

// ── Schema-driven form data coercion ────────────────────────────────────────

/**
 * Coerce form data values to match the types declared in the OpenAPI schema.
 * HTML inputs always produce strings; this converts them to integers, numbers,
 * booleans, etc. as needed. Also strips empty-string values for optional fields
 * so they don't fail enum/type validation on the server.
 *
 * Works generically for any API — reads types from the schema at runtime.
 */
export function coerceFormData(
  data: Record<string, unknown>,
  schema: SchemaProperty,
): Record<string, unknown> {
  const resolved = resolveAllOf(schema);
  const props = resolved.properties ?? {};
  const requiredKeys = new Set(resolved.required ?? []);
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    const prop = props[key] ? resolveAllOf(props[key]) : undefined;

    // Skip unknown fields or undefined values
    if (!prop || value === undefined) {
      if (value !== undefined) result[key] = value;
      continue;
    }

    // Strip empty strings for optional fields (avoids enum validation failures)
    if (value === '' && !requiredKeys.has(key)) continue;

    // Coerce based on schema type
    if (prop.type === 'integer' && typeof value === 'string') {
      if (value === '') continue;
      const n = parseInt(value, 10);
      if (!isNaN(n)) { result[key] = n; continue; }
    }
    if (prop.type === 'number' && typeof value === 'string') {
      if (value === '') continue;
      const n = parseFloat(value);
      if (!isNaN(n)) { result[key] = n; continue; }
    }
    if (prop.type === 'boolean') {
      if (typeof value === 'string') { result[key] = value === 'true'; continue; }
      if (Array.isArray(value)) { result[key] = value.includes('true'); continue; }
    }

    // Recurse into nested objects
    if (prop.type === 'object' && prop.properties && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = coerceFormData(value as Record<string, unknown>, prop);
      continue;
    }

    result[key] = value;
  }

  return result;
}

// ── Schema-driven required marking ──────────────────────────────────────────

/**
 * Build a set of dot-path field refs that are required according to the schema.
 * Walks nested objects so both top-level and nested required fields are captured.
 */
function collectRequiredRefs(
  schema: SchemaProperty,
  prefix: string,
  out: Set<string>,
): void {
  const resolved = resolveAllOf(schema);
  const requiredKeys = new Set(resolved.required ?? []);
  const props = resolved.properties ?? {};

  for (const [key, rawProp] of Object.entries(props)) {
    const ref = prefix ? `${prefix}.${key}` : key;
    if (requiredKeys.has(key)) out.add(ref);

    const prop = resolveAllOf(rawProp);
    if (prop.type === 'object' && prop.properties) {
      collectRequiredRefs(prop, ref, out);
    }
    if (prop.type === 'array' && prop.items) {
      const itemSchema = resolveAllOf(prop.items);
      if (itemSchema.type === 'object' && itemSchema.properties) {
        // Array item fields use the bare key (no index), matching generateFields behavior
        collectRequiredRefs(itemSchema, '', out);
      }
    }
  }
}

/**
 * Enrich a FormContract's fields with `required: true` based on the OpenAPI schema's
 * `required` arrays. Works for both hand-written YAML contracts and generated ones.
 * Returns a new contract (does not mutate the input).
 */
export function markRequiredFields(
  contract: FormContract,
  schema: SchemaProperty,
): FormContract {
  const requiredRefs = new Set<string>();
  collectRequiredRefs(schema, '', requiredRefs);
  if (requiredRefs.size === 0) return contract;

  function enrichFields(fields: FieldDefinition[]): FieldDefinition[] {
    return fields.map((f) => {
      const enriched = { ...f };
      if (requiredRefs.has(f.ref)) enriched.required = true;
      if (f.fields) enriched.fields = enrichFields(f.fields);
      return enriched;
    });
  }

  return {
    ...contract,
    form: {
      ...contract.form,
      pages: contract.form.pages.map((page) => ({
        ...page,
        fields: page.fields ? enrichFields(page.fields) : page.fields,
      })),
    },
  };
}
