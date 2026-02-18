/**
 * Step 5: Resolved OpenAPI spec → Zod schemas
 *
 * Walks the resolved spec and generates a Zod schema file that matches the
 * structure the storybook already imports (applicationCreateSchema, etc.).
 *
 * This is a direct code generator rather than using @hey-api/openapi-ts,
 * because we need precise control over the output shape to match the existing
 * form engine expectations (nested objects, optional fields, array wrappers).
 *
 * Output: overwrites src/schemas/application.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import yaml from 'js-yaml';

/**
 * @param {string} specPath - Path to resolved OpenAPI YAML
 * @param {string} outPath - Path for output .ts file
 */
export function generateZodSchemas(specPath, outPath) {
  const text = readFileSync(specPath, 'utf-8');
  const spec = yaml.load(text);
  const schemas = spec.components?.schemas || {};
  const apiId = spec.info?.['x-api-id'] || null;

  const lines = [];
  lines.push("import { z } from 'zod';");
  lines.push('');

  // Collect all enum fields across all schemas to generate named enums
  const enums = new Map();
  collectEnums(schemas, enums);

  // Generate enum declarations
  lines.push('// =============================================================================');
  lines.push('// Enums (generated from resolved OpenAPI spec)');
  lines.push('// =============================================================================');
  lines.push('');

  for (const [enumName, values] of enums) {
    lines.push(`export const ${enumName} = z.enum([`);
    for (const v of values) {
      lines.push(`  '${v}',`);
    }
    lines.push(']);');
    lines.push('');
  }

  // Generate sub-schemas bottom-up: Expense, Asset, Income, Person, Household, Application
  lines.push('// =============================================================================');
  lines.push('// Sub-schemas');
  lines.push('// =============================================================================');
  lines.push('');

  const entityOrder = ['Expense', 'Asset', 'Income', 'Person', 'Household'];
  for (const name of entityOrder) {
    const schema = schemas[name];
    if (!schema) continue;
    const varName = name.charAt(0).toLowerCase() + name.slice(1) + 'Schema';
    lines.push(`export const ${varName} = z.object({`);
    generateProperties(schema.properties || {}, schemas, enums, lines, '  ');
    lines.push('});');
    lines.push('');
  }

  // Application schemas
  lines.push('// =============================================================================');
  lines.push('// Application schemas');
  lines.push('// =============================================================================');
  lines.push('');

  const appSchema = schemas.Application;
  if (appSchema) {
    const describeCreate = apiId ? `.describe('${apiId}/ApplicationCreate')` : '';
    const describeUpdate = apiId ? `.describe('${apiId}/ApplicationUpdate')` : '';
    lines.push('export const applicationCreateSchema = z.object({');
    generateProperties(appSchema.properties || {}, schemas, enums, lines, '  ');
    lines.push(`})${describeCreate};`);
    lines.push('');
    lines.push('export type ApplicationCreate = z.infer<typeof applicationCreateSchema>;');
    lines.push('');
    lines.push(`export const applicationUpdateSchema = applicationCreateSchema.partial()${describeUpdate};`);
    lines.push('');
    lines.push('export type ApplicationUpdate = z.infer<typeof applicationUpdateSchema>;');
    lines.push('');
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, lines.join('\n'));

  const fieldCount = countFields(schemas);
  console.log(`  Generated ${enums.size} enums, ${fieldCount} fields`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Collect named enums from all schemas */
function collectEnums(schemas, enums) {
  // Well-known enum fields and their generated names
  const enumNameMap = {
    'programsAppliedFor': 'programEnum',
    'gender': 'genderEnum',
    'race': 'raceEnum',
    'ethnicity': 'ethnicityEnum',
    'citizenshipStatus': 'citizenshipStatusEnum',
    'maritalStatus': 'maritalStatusEnum',
    'relationshipToApplicant': 'relationshipEnum',
    'livingArrangement': 'livingArrangementEnum',
    'noticeDeliveryPreference': 'noticeDeliveryPreferenceEnum',
    'frequency': 'frequencyEnum',
  };

  // Type-based enum names for Income.type, Asset.type, Expense.type
  const typeEnumMap = {
    'Income': 'incomeTypeEnum',
    'Asset': 'assetTypeEnum',
    'Expense': 'expenseTypeEnum',
  };

  for (const [schemaName, schema] of Object.entries(schemas)) {
    if (!schema.properties) continue;

    for (const [propName, prop] of Object.entries(schema.properties)) {
      // Direct enum or array-of-enum (enum[])
      const enumValues = prop.enum || (prop.type === 'array' && prop.items?.enum);
      if (enumValues) {
        let enumName;
        if (propName === 'type' && typeEnumMap[schemaName]) {
          enumName = typeEnumMap[schemaName];
        } else if (enumNameMap[propName]) {
          enumName = enumNameMap[propName];
        } else {
          enumName = propName + 'Enum';
        }

        if (!enums.has(enumName)) {
          enums.set(enumName, enumValues);
        }
      }

      // Check nested object properties for enums too
      if (prop.type === 'object' && prop.properties) {
        for (const [subName, subProp] of Object.entries(prop.properties)) {
          if (subProp.enum) {
            const subEnumName = subName + 'Enum';
            if (!enums.has(subEnumName)) {
              enums.set(subEnumName, subProp.enum);
            }
          }
        }
      }
    }
  }
}

/** Generate z.object property lines for a set of OpenAPI properties */
function generateProperties(properties, schemas, enums, lines, indent) {
  for (const [propName, prop] of Object.entries(properties)) {
    // Skip x- extensions
    if (propName.startsWith('x-')) continue;

    const zodType = propToZod(propName, prop, schemas, enums);
    lines.push(`${indent}${propName}: ${zodType},`);
  }
}

/** Convert an OpenAPI property to a Zod type expression */
function propToZod(propName, prop, schemas, enums) {
  // $ref — reference to another schema
  if (prop.$ref) {
    const refName = prop.$ref.split('/').pop();
    const varName = refName.charAt(0).toLowerCase() + refName.slice(1) + 'Schema';
    return varName;
  }

  // Array with $ref items — e.g. members: array of Person
  if (prop.type === 'array' && prop.items) {
    if (prop.items.$ref) {
      const refName = prop.items.$ref.split('/').pop();
      const varName = refName.charAt(0).toLowerCase() + refName.slice(1) + 'Schema';
      return `z.array(${varName}).optional()`;
    }
    // Array of enum
    if (prop.items.enum) {
      const enumName = findEnumName(propName, prop.items.enum, enums);
      if (enumName) return `z.array(${enumName}).optional()`;
      return `z.array(z.string()).optional()`;
    }
    // Array of primitive
    const itemType = primitiveToZod(prop.items);
    return `z.array(${itemType}).optional()`;
  }

  // Nested object (Household sub-groups)
  if (prop.type === 'object' && prop.properties) {
    const inner = [];
    for (const [subName, subProp] of Object.entries(prop.properties)) {
      if (subName.startsWith('x-')) continue;
      const subZod = propToZod(subName, subProp, schemas, enums);
      inner.push(`    ${subName}: ${subZod},`);
    }
    return `z.object({\n${inner.join('\n')}\n  }).optional()`;
  }

  // Enum
  if (prop.enum) {
    const enumName = findEnumName(propName, prop.enum, enums);
    if (enumName) return `${enumName}.optional()`;
    return `z.string().optional()`;
  }

  // Primitive types
  return primitiveToZod(prop) + '.optional()';
}

function primitiveToZod(prop) {
  switch (prop.type) {
    case 'string':
      if (prop.format === 'date') return "z.string()";
      if (prop.format === 'date-time') return "z.string()";
      return 'z.string()';
    case 'integer':
      return 'z.number().int()';
    case 'number':
      return 'z.number()';
    case 'boolean':
      return 'z.boolean()';
    default:
      return 'z.string()';
  }
}

/** Find the enum name for a set of values in our enum map */
function findEnumName(propName, values, enums) {
  // Direct match by values
  for (const [name, vals] of enums) {
    if (vals.length === values.length && vals.every((v, i) => v === values[i])) {
      return name;
    }
  }
  return null;
}

function countFields(schemas) {
  let count = 0;
  for (const schema of Object.values(schemas)) {
    if (schema.properties) {
      count += Object.keys(schema.properties).filter(k => !k.startsWith('x-')).length;
    }
  }
  return count;
}
