import type {
  FieldDefinition,
  PermissionsPolicy,
  ReferenceColumn,
  Page,
  AnnotationLayer,
  AnnotationEntry,
} from './types';
import { labelFromRef, stripIndices } from './field-utils';
import { resolvePermission } from './PermissionsResolver';

// ---------------------------------------------------------------------------
// Schema resolution
// ---------------------------------------------------------------------------

export interface SchemaProperty {
  type?: string;
  format?: string;
  enum?: string[];
  description?: string;
}

export function resolveSchemaProperty(
  spec: Record<string, unknown>,
  dotPath: string,
): SchemaProperty | null {
  if (!spec) return null;
  const schemas = (spec as any)?.components?.schemas;
  if (!schemas) return null;

  const segments = stripIndices(dotPath).split('.');
  let current: any = schemas.Application;

  for (let i = 0; i < segments.length; i++) {
    if (!current?.properties) return null;
    const prop = current.properties[segments[i]];
    if (!prop) return null;

    if (i === segments.length - 1) return prop as SchemaProperty;

    if (prop.$ref) {
      current = schemas[prop.$ref.split('/').pop()!];
      continue;
    }
    if (prop.items?.$ref) {
      current = schemas[prop.items.$ref.split('/').pop()!];
      continue;
    }
    if (prop.type === 'object' && prop.properties) {
      current = prop;
      continue;
    }
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Annotation resolution
// ---------------------------------------------------------------------------

export { type AnnotationEntry } from './types';

export function resolveAnnotation(
  layerData: Record<string, unknown> | undefined,
  fieldRef: string,
): AnnotationEntry | null {
  if (!layerData) return null;
  const fields = (layerData as any)?.fields;
  if (!fields) return null;
  const stripped = stripIndices(fieldRef);
  return (fields[stripped] ?? fields[fieldRef]) as AnnotationEntry | null;
}

// ---------------------------------------------------------------------------
// Column value resolution
// ---------------------------------------------------------------------------

export function resolveAnnotationValue(
  annotation: AnnotationEntry | null,
  path: string,
): string {
  if (!annotation) return '';
  switch (path) {
    case 'label': return annotation.label ?? '';
    case 'source': return annotation.source ?? '';
    case 'statute': return annotation.statute ?? '';
    case 'notes': return annotation.notes ?? '';
    case 'programs': {
      const programs = annotation.programs;
      return programs ? Object.keys(programs).join(', ') : '';
    }
    default: {
      if (path.startsWith('programs.')) {
        return annotation.programs?.[path.slice('programs.'.length)] ?? '';
      }
      return String(annotation[path] ?? '');
    }
  }
}

export function resolveColumnValue(
  column: ReferenceColumn,
  field: FieldDefinition,
  fullRef: string,
  annotationsByLayer: Record<string, AnnotationEntry | null>,
  schemaSpec: Record<string, unknown> | undefined,
  permissionsPolicies: PermissionsPolicy[],
): string {
  const [namespace, ...pathParts] = column.from.split('.');
  const path = pathParts.join('.');

  switch (namespace) {
    case 'field': {
      switch (path) {
        case 'ref': return stripIndices(fullRef);
        case 'component': return field.component;
        case 'label': return labelFromRef(fullRef);
        case 'hint': return field.hint ?? '';
        case 'width': return field.width ?? 'full';
        default: return '';
      }
    }
    case 'schema': {
      if (!schemaSpec) return '';
      const prop = resolveSchemaProperty(schemaSpec, stripIndices(fullRef));
      if (!prop) return '';
      switch (path) {
        case 'type': return prop.type ?? '';
        case 'format': return prop.format ?? '';
        case 'enum': return prop.enum?.join(', ') ?? '';
        case 'description': return prop.description ?? '';
        default: return '';
      }
    }
    case 'annotation': {
      const [layerName, ...restParts] = pathParts;
      if (!layerName) return '';
      const entry = annotationsByLayer[layerName];
      return resolveAnnotationValue(entry ?? null, restParts.join('.'));
    }
    case 'permissions': {
      const policy = permissionsPolicies.find((p) => p.role === path);
      if (!policy) return '';
      return resolvePermission(field, path as any, policy);
    }
    default: return '';
  }
}

// ---------------------------------------------------------------------------
// Field flattening
// ---------------------------------------------------------------------------

export function flattenFields(
  fields: FieldDefinition[],
  parentRef?: string,
): { field: FieldDefinition; fullRef: string }[] {
  const result: { field: FieldDefinition; fullRef: string }[] = [];
  for (const field of fields) {
    const fullRef = parentRef ? `${parentRef}.${field.ref}` : field.ref;
    if (field.component === 'field-array' && field.fields) {
      result.push({ field, fullRef });
      result.push(...flattenFields(field.fields, fullRef));
    } else {
      result.push({ field, fullRef });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Resolved row
// ---------------------------------------------------------------------------

export interface ResolvedRow {
  idx: number;
  field: FieldDefinition;
  fullRef: string;
  pageId: string;
  pageTitle: string;
  values: Record<string, string>; // keyed by column.from
  /** Original data object for API-source rows. */
  rawData?: Record<string, unknown>;
}

export type SortDirection = 'asc' | 'desc';

// ---------------------------------------------------------------------------
// Row building
// ---------------------------------------------------------------------------

export function resolveContractRows(
  pages: Page[],
  columns: ReferenceColumn[],
  annotationLayers: AnnotationLayer[],
  permissionsPolicies: PermissionsPolicy[],
  schemaSpec?: Record<string, unknown>,
): ResolvedRow[] {
  const rows: ResolvedRow[] = [];
  let idx = 0;
  for (const page of pages) {
    for (const { field, fullRef } of flattenFields(page.fields ?? [])) {
      const byLayer: Record<string, AnnotationEntry | null> = {};
      for (const layer of annotationLayers) {
        byLayer[layer.name] = resolveAnnotation(layer.data, fullRef);
      }

      const values: Record<string, string> = {};
      for (const col of columns) {
        values[col.from] = resolveColumnValue(col, field, fullRef, byLayer, schemaSpec, permissionsPolicies);
      }

      rows.push({ idx: idx++, field, fullRef, pageId: page.id, pageTitle: page.title, values });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export function sortRows(
  rows: ResolvedRow[],
  sortCol: string,
  sortDir: SortDirection,
): ResolvedRow[] {
  return [...rows].sort((a, b) => {
    const va = a.values[sortCol] ?? '';
    const vb = b.values[sortCol] ?? '';
    if (va === '' && vb !== '') return 1;
    if (va !== '' && vb === '') return -1;
    const cmp = va.localeCompare(vb, undefined, { sensitivity: 'base' });
    return sortDir === 'desc' ? -cmp : cmp;
  });
}
