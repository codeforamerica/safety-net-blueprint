#!/usr/bin/env node
/**
 * Modular Zod Schema Generator
 *
 * Generates Zod schemas from OpenAPI specs in a modular way to avoid
 * TypeScript's type complexity limits. Instead of inlining everything,
 * it generates small composable schemas that reference each other.
 *
 * Key principle: When TypeScript sees `z.object({ name: Name })` where Name
 * is already defined, it doesn't need to re-serialize the full type - it just
 * references it. This dramatically reduces .d.ts file sizes.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, basename, extname, dirname } from 'path';
import { fileURLToPath } from 'url';
import $RefParser from '@apidevtools/json-schema-ref-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Extract schema name from a $ref
 */
function extractRefName(ref) {
  // Handle #/components/schemas/SchemaName
  if (ref.startsWith('#/components/schemas/')) {
    return ref.split('/').pop();
  }
  // Handle #/SchemaName (local to file)
  if (ref.startsWith('#/')) {
    return ref.split('/').pop();
  }
  // Handle just SchemaName
  return ref.split('/').pop();
}

/**
 * Convert OpenAPI type to Zod validator
 */
function openAPITypeToZod(schema, schemaName, allSchemas, indent = '') {
  if (!schema) {
    return 'z.unknown()';
  }

  // Handle $ref - reference another schema
  if (schema.$ref) {
    const refName = extractRefName(schema.$ref);
    // Only reference if it's a known schema
    if (allSchemas[refName]) {
      return refName;
    }
    // Otherwise inline it (external ref that was bundled)
    return 'z.unknown()';
  }

  // Handle allOf - intersection/extension
  if (schema.allOf) {
    const parts = schema.allOf.map((s, i) => {
      if (s.$ref) {
        const refName = extractRefName(s.$ref);
        if (allSchemas[refName]) {
          return refName;
        }
      }
      // Inline object extension
      return openAPITypeToZod(s, `${schemaName}_part${i}`, allSchemas, indent);
    });

    // Filter out empty parts and combine with .merge() or .extend()
    const nonEmptyParts = parts.filter(p => p && p !== 'z.object({})');
    if (nonEmptyParts.length === 0) return 'z.object({})';
    if (nonEmptyParts.length === 1) return nonEmptyParts[0];

    // Use .extend() for object compositions
    return nonEmptyParts.reduce((acc, part, i) => {
      if (i === 0) return part;
      // If part is a z.object(), use .extend()
      if (part.startsWith('z.object(')) {
        const inner = part.slice('z.object('.length, -1);
        return `${acc}.extend(${inner})`;
      }
      return `${acc}.merge(${part})`;
    });
  }

  // Handle anyOf - union
  if (schema.anyOf) {
    const parts = schema.anyOf.map((s, i) =>
      openAPITypeToZod(s, `${schemaName}_anyOf${i}`, allSchemas, indent)
    );
    if (parts.length === 1) return parts[0];
    return `z.union([${parts.join(', ')}])`;
  }

  // Handle oneOf - discriminated union
  if (schema.oneOf) {
    const parts = schema.oneOf.map((s, i) =>
      openAPITypeToZod(s, `${schemaName}_oneOf${i}`, allSchemas, indent)
    );
    if (parts.length === 1) return parts[0];
    return `z.union([${parts.join(', ')}])`;
  }

  // Handle enum
  if (schema.enum) {
    if (schema.type === 'string') {
      const values = schema.enum.map(v => `'${v}'`).join(', ');
      return `z.enum([${values}])`;
    }
    // Numeric or mixed enum
    const values = schema.enum.map(v =>
      typeof v === 'string' ? `'${v}'` : v
    ).join(', ');
    return `z.enum([${values}])`;
  }

  // Handle type
  switch (schema.type) {
    case 'string':
      let stringValidator = 'z.string()';
      if (schema.format === 'uuid') stringValidator += '.uuid()';
      else if (schema.format === 'email') stringValidator += '.email()';
      else if (schema.format === 'uri') stringValidator += '.url()';
      else if (schema.format === 'date') stringValidator = 'z.string()'; // date as string
      else if (schema.format === 'date-time') stringValidator = 'z.string().datetime()';
      if (schema.pattern) stringValidator += `.regex(/${schema.pattern}/)`;
      if (schema.minLength) stringValidator += `.min(${schema.minLength})`;
      if (schema.maxLength) stringValidator += `.max(${schema.maxLength})`;
      return stringValidator;

    case 'integer':
    case 'number':
      let numValidator = 'z.number()';
      if (schema.type === 'integer') numValidator += '.int()';
      if (schema.minimum !== undefined) numValidator += `.min(${schema.minimum})`;
      if (schema.maximum !== undefined) numValidator += `.max(${schema.maximum})`;
      return numValidator;

    case 'boolean':
      return 'z.boolean()';

    case 'array':
      const itemsType = openAPITypeToZod(schema.items, `${schemaName}_item`, allSchemas, indent);
      let arrayValidator = `z.array(${itemsType})`;
      if (schema.minItems) arrayValidator += `.min(${schema.minItems})`;
      if (schema.maxItems) arrayValidator += `.max(${schema.maxItems})`;
      return arrayValidator;

    case 'object':
      return generateObjectZod(schema, schemaName, allSchemas, indent);

    default:
      // No type specified - could be anything
      if (schema.properties || schema.additionalProperties !== undefined) {
        return generateObjectZod(schema, schemaName, allSchemas, indent);
      }
      return 'z.unknown()';
  }
}

/**
 * Generate Zod for an object schema
 */
function generateObjectZod(schema, schemaName, allSchemas, indent) {
  const properties = schema.properties || {};
  const required = schema.required || [];
  const propEntries = Object.entries(properties);

  if (propEntries.length === 0) {
    if (schema.additionalProperties) {
      const valueType = openAPITypeToZod(
        schema.additionalProperties === true ? {} : schema.additionalProperties,
        `${schemaName}_value`,
        allSchemas,
        indent
      );
      return `z.record(z.string(), ${valueType})`;
    }
    return 'z.object({})';
  }

  const innerIndent = indent + '  ';
  const propLines = propEntries.map(([propName, propSchema]) => {
    let propZod = openAPITypeToZod(propSchema, `${schemaName}_${propName}`, allSchemas, innerIndent);

    // Add .optional() for non-required fields
    if (!required.includes(propName)) {
      // Don't double-wrap with optional
      if (!propZod.endsWith('.optional()')) {
        propZod += '.optional()';
      }
    }

    return `${innerIndent}${propName}: ${propZod},`;
  });

  let result = `z.object({\n${propLines.join('\n')}\n${indent}})`;

  // Handle additionalProperties
  if (schema.additionalProperties === false) {
    result += '.strict()';
  } else if (schema.additionalProperties) {
    result += '.passthrough()';
  }

  return result;
}

/**
 * Sort schemas by dependency order (leaf schemas first)
 */
function topologicalSort(schemas) {
  const visited = new Set();
  const visiting = new Set();
  const result = [];
  const schemaNames = new Set(Object.keys(schemas));

  function getDependencies(schema) {
    const deps = new Set();

    function walk(obj) {
      if (!obj || typeof obj !== 'object') return;

      if (obj.$ref) {
        // Extract local schema name from various ref formats
        const refPath = obj.$ref;
        let refName = null;

        if (refPath.startsWith('#/components/schemas/')) {
          refName = refPath.split('/').pop();
        } else if (refPath.startsWith('#/')) {
          refName = refPath.split('/').pop();
        } else if (refPath.includes('#/')) {
          // Handle ./file.yaml#/SchemaName
          refName = refPath.split('#/').pop().split('/').pop();
        } else if (!refPath.includes('/') && !refPath.startsWith('.')) {
          refName = refPath;
        }

        if (refName && schemaNames.has(refName)) {
          deps.add(refName);
        }
        return;
      }

      if (Array.isArray(obj)) {
        obj.forEach(walk);
      } else {
        Object.values(obj).forEach(walk);
      }
    }

    walk(schema);
    return deps;
  }

  function visit(name) {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      // Circular dependency - will need z.lazy()
      console.log(`  Warning: Circular dependency detected: ${name}`);
      return;
    }

    visiting.add(name);

    const schema = schemas[name];
    if (schema) {
      const deps = getDependencies(schema);
      for (const dep of deps) {
        visit(dep);
      }
    }

    visiting.delete(name);
    visited.add(name);
    result.push(name);
  }

  Object.keys(schemas).forEach(visit);
  return result;
}

/**
 * Collect all schemas from a spec and its referenced files
 */
async function collectAllSchemas(specPath) {
  const refs = await $RefParser.resolve(specPath);
  const allSchemas = {};

  // Get all resolved file values
  const files = refs.values();

  for (const [filePath, content] of Object.entries(files)) {
    if (!content || typeof content !== 'object') continue;

    // Collect from components/schemas if present
    if (content.components?.schemas) {
      Object.assign(allSchemas, content.components.schemas);
    }

    // Collect top-level schemas (like in application.yaml, person.yaml)
    for (const [key, value] of Object.entries(content)) {
      // Skip non-schema keys
      if (['openapi', 'info', 'servers', 'tags', 'paths', 'components', 'security'].includes(key)) {
        continue;
      }
      // Skip if not an object or if it's an array
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        continue;
      }
      // Check if it looks like a schema (has type, properties, allOf, etc.)
      if (value.type || value.properties || value.allOf || value.anyOf || value.oneOf || value.enum) {
        allSchemas[key] = value;
      }
    }
  }

  return allSchemas;
}

/**
 * Generate modular Zod schemas for an OpenAPI spec
 */
async function generateModularZod(specPath, outputPath) {
  console.log(`Generating modular Zod schemas for: ${basename(specPath)}`);

  // Collect all schemas from the spec and its references
  const schemas = await collectAllSchemas(specPath);
  const schemaNames = Object.keys(schemas);

  if (schemaNames.length === 0) {
    console.log('  No schemas found, skipping');
    return;
  }

  // Sort by dependencies
  const sortedNames = topologicalSort(schemas);

  // Generate Zod code
  const lines = [
    '/**',
    ' * Modular Zod schemas generated from OpenAPI spec.',
    ' * Auto-generated - do not edit manually.',
    ' */',
    '',
    "import { z } from 'zod';",
    '',
  ];

  // Generate each schema as a named export
  for (const name of sortedNames) {
    const schema = schemas[name];
    const zodCode = openAPITypeToZod(schema, name, schemas, '');

    // Format multi-line objects
    const formattedCode = zodCode.replace(/\n/g, '\n');

    lines.push(`export const ${name} = ${formattedCode};`);
    lines.push(`export type ${name}Type = z.infer<typeof ${name}>;`);
    lines.push('');
  }

  // Add schemas export for compatibility
  // Use explicit type to avoid TypeScript inference overflow
  lines.push('// Schemas object for compatibility with existing usage');
  lines.push('// Using explicit type annotation to avoid TS7056 inference overflow');
  lines.push(`export const schemas: {`);
  for (const name of sortedNames) {
    lines.push(`  ${name}: typeof ${name};`);
  }
  lines.push('} = {');
  for (const name of sortedNames) {
    lines.push(`  ${name},`);
  }
  lines.push('};');
  lines.push('');

  // Write output
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, lines.join('\n'));
  console.log(`  Generated: ${outputPath}`);
  console.log(`  Schemas: ${sortedNames.length}`);
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log('Usage: generate-modular-zod.js <input-spec.yaml> <output.schemas.ts>');
    console.log('');
    console.log('Or run without args to generate all specs:');
    console.log('  generate-modular-zod.js --all');
    process.exit(1);
  }

  if (args[0] === '--all') {
    // Generate for all specs
    const specsDir = join(__dirname, '..', '..', 'schemas', 'openapi', 'resolved');
    const outputDir = join(__dirname, '..', 'generated');
    const specs = ['applications', 'households', 'incomes', 'persons'];

    for (const spec of specs) {
      const inputPath = join(specsDir, `${spec}.yaml`);
      const outputPath = join(outputDir, `${spec}.schemas.ts`);
      try {
        await generateModularZod(inputPath, outputPath);
      } catch (error) {
        console.error(`Failed to generate ${spec}:`, error.message);
      }
    }
  } else {
    const [inputPath, outputPath] = args;
    await generateModularZod(inputPath, outputPath);
  }
}

main().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
