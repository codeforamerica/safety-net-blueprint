/**
 * Schema registry — imports all OpenAPI specs and generates form pages/fields
 * from a given top-level schema name.
 */
import applicationsSpec from '@openapi/applications-openapi.yaml';
import householdsSpec from '@openapi/households-openapi.yaml';
import incomesSpec from '@openapi/incomes-openapi.yaml';
import personsSpec from '@openapi/persons-openapi.yaml';
import usersSpec from '@openapi/users-openapi.yaml';
import workflowSpec from '@openapi/workflow-openapi.yaml';
import caseManagementSpec from '@openapi/case-management-openapi.yaml';
import schedulingSpec from '@openapi/scheduling-openapi.yaml';

// --- Types ---------------------------------------------------------------

interface OASchema {
  type?: string;
  format?: string;
  enum?: string[];
  properties?: Record<string, OASchema>;
  required?: string[];
  allOf?: OASchema[];
  $ref?: string;
  items?: OASchema;
  readOnly?: boolean;
  description?: string;
}

interface FieldDef {
  ref: string;
  component: string;
  width?: string;
  hint?: string;
  labels?: Record<string, string>;
  fields?: FieldDef[];
  min_items?: number;
  max_items?: number;
}

interface PageDef {
  id: string;
  title: string;
  fields: FieldDef[];
}

type Spec = Record<string, unknown>;

// --- Registry ------------------------------------------------------------

const SCHEMA_MAP: Record<string, { spec: Spec; schema: string }> = {
  Application: { spec: applicationsSpec as Spec, schema: 'Application' },
  Appointment: { spec: schedulingSpec as Spec, schema: 'Appointment' },
  Case: { spec: caseManagementSpec as Spec, schema: 'Case' },
  Household: { spec: householdsSpec as Spec, schema: 'Household' },
  Income: { spec: incomesSpec as Spec, schema: 'Income' },
  Person: { spec: personsSpec as Spec, schema: 'Person' },
  Task: { spec: workflowSpec as Spec, schema: 'Task' },
  User: { spec: usersSpec as Spec, schema: 'User' },
};

export const SCHEMA_NAMES = Object.keys(SCHEMA_MAP);

// --- Helpers -------------------------------------------------------------

const SYSTEM_FIELDS = new Set(['id', 'createdAt', 'updatedAt']);

function getSchemas(spec: Spec): Record<string, OASchema> {
  const components = spec.components as Record<string, unknown> | undefined;
  return (components?.schemas ?? {}) as Record<string, OASchema>;
}

function resolveLocalRef(schemas: Record<string, OASchema>, ref: string): OASchema | null {
  if (!ref.startsWith('#/components/schemas/')) return null;
  const name = ref.split('/').pop()!;
  return schemas[name] ?? null;
}

function resolveSchema(schemas: Record<string, OASchema>, schema: OASchema): OASchema {
  if (schema.$ref) {
    const resolved = resolveLocalRef(schemas, schema.$ref);
    if (resolved) return resolveSchema(schemas, resolved);
    return schema;
  }

  if (schema.allOf) {
    const merged: OASchema = { type: 'object', properties: {}, required: [] };
    for (const sub of schema.allOf) {
      const resolved = resolveSchema(schemas, sub);
      if (resolved.properties) {
        merged.properties = { ...merged.properties, ...resolved.properties };
      }
      if (resolved.required) {
        merged.required = [...(merged.required ?? []), ...resolved.required];
      }
    }
    return merged;
  }

  return schema;
}

function formatLabel(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')   // camelCase → words
    .replace(/_/g, ' ')                      // snake_case → words
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function mapField(
  ref: string,
  prop: OASchema,
  schemas: Record<string, OASchema>,
  depth: number,
): FieldDef | null {
  let resolved = prop;
  if (prop.$ref) {
    const r = resolveLocalRef(schemas, prop.$ref);
    if (r) {
      resolved = resolveSchema(schemas, r);
    } else {
      // External ref we can't resolve — placeholder
      const name = prop.$ref.split('/').pop() ?? ref;
      return { ref, component: 'text-input', hint: name };
    }
  }

  if (resolved.type === 'string') {
    if (resolved.format === 'date') return { ref, component: 'date-input' };
    if (resolved.enum) {
      return {
        ref,
        component: 'select',
        labels: Object.fromEntries(resolved.enum.map((e) => [e, formatLabel(e)])),
      };
    }
    return { ref, component: 'text-input' };
  }

  if (resolved.type === 'boolean') {
    return { ref, component: 'radio', labels: { true: 'Yes', false: 'No' } };
  }

  if (resolved.type === 'number' || resolved.type === 'integer') {
    return { ref, component: 'text-input' };
  }

  if (resolved.type === 'array' && resolved.items) {
    const itemSchema = resolved.items.$ref
      ? resolveSchema(schemas, resolved.items)
      : resolved.items;
    if (itemSchema.properties && depth < 2) {
      const subFields = fieldsFromProperties(schemas, itemSchema.properties, depth + 1);
      return { ref, component: 'field-array', fields: subFields, min_items: 0, max_items: 10 };
    }
    return { ref, component: 'text-input', hint: 'list' };
  }

  // Object with properties at current depth — flatten into dot-paths handled by caller
  if (resolved.type === 'object' && resolved.properties && depth < 2) {
    return null; // signals caller to create a separate page
  }

  return { ref, component: 'text-input' };
}

function fieldsFromProperties(
  schemas: Record<string, OASchema>,
  properties: Record<string, OASchema>,
  depth: number,
): FieldDef[] {
  const fields: FieldDef[] = [];
  for (const [key, prop] of Object.entries(properties)) {
    if (SYSTEM_FIELDS.has(key)) continue;
    if (prop.readOnly) continue;
    const field = mapField(key, prop, schemas, depth);
    if (field) fields.push(field);
  }
  return fields;
}

// --- Public API ----------------------------------------------------------

export function generatePagesForSchema(schemaName: string): PageDef[] | null {
  const entry = SCHEMA_MAP[schemaName];
  if (!entry) return null;

  const schemas = getSchemas(entry.spec);
  const rawSchema = schemas[entry.schema];
  if (!rawSchema) return null;

  const resolved = resolveSchema(schemas, rawSchema);
  const properties = resolved.properties ?? {};

  const simpleFields: FieldDef[] = [];
  const objectPages: PageDef[] = [];

  for (const [key, prop] of Object.entries(properties)) {
    if (SYSTEM_FIELDS.has(key)) continue;
    if (prop.readOnly) continue;

    // Resolve to see if it's an object sub-schema
    let resolvedProp = prop;
    if (prop.$ref) {
      const r = resolveLocalRef(schemas, prop.$ref);
      if (r) resolvedProp = resolveSchema(schemas, r);
    }

    if (resolvedProp.type === 'object' && resolvedProp.properties) {
      const fields = fieldsFromProperties(schemas, resolvedProp.properties, 1);
      if (fields.length > 0) {
        objectPages.push({
          id: key,
          title: formatLabel(key),
          fields: fields.map((f) => ({ ...f, ref: `${key}.${f.ref}` })),
        });
      }
    } else {
      const field = mapField(key, prop, schemas, 0);
      if (field) simpleFields.push(field);
    }
  }

  const pages: PageDef[] = [];
  if (simpleFields.length > 0) {
    pages.push({ id: 'general', title: 'General', fields: simpleFields });
  }
  pages.push(...objectPages);

  if (pages.length === 0) {
    pages.push({ id: 'general', title: 'General', fields: [] });
  }

  return pages;
}
