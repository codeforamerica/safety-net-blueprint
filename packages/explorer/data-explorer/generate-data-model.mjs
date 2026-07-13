#!/usr/bin/env node
/**
 * generate-data-model.mjs
 *
 * Generates a domain data model YAML in dot-notation from an OpenAPI spec.
 * Walks schemas reachable from the spec, emitting one line per leaf field.
 *
 * Usage: node generate-data-model.mjs --domain=intake
 * Output: output/{domain}-data-model.yaml
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import yaml from 'js-yaml';
import $RefParser from '@apidevtools/json-schema-ref-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONTRACTS_DIR = resolve(__dirname, '../../contracts');
const OUTPUT_DIR = join(__dirname, 'output');


// ─── CLI ─────────────────────────────────────────────────────────────────────

const cliArgs = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const eq = a.indexOf('=');
      return eq >= 0 ? [a.slice(2, eq), a.slice(eq + 1)] : [a.slice(2), true];
    })
);

if (!cliArgs.domain) {
  console.error('Usage: node generate-data-model.mjs --domain=<domain>');
  process.exit(1);
}
const { domain } = cliArgs;

// ─── Schema helpers ───────────────────────────────────────────────────────────

/**
 * Collect all properties from a schema and its allOf parts (merged, last wins).
 * Works on fully-dereferenced schemas — no $ref resolution needed here.
 */
function collectProps(schema) {
  if (!schema || typeof schema !== 'object') return {};
  const result = {};
  for (const part of schema.allOf || []) Object.assign(result, collectProps(part));
  if (schema.properties) Object.assign(result, schema.properties);
  return result;
}

/** True if a schema resolves to an object with sub-properties. */
function hasProps(schema) {
  return Object.keys(collectProps(schema)).length > 0;
}

/** Build a leaf entry for a scalar field. */
function buildLeaf(schema, descriptionOverride) {
  if (!schema || typeof schema !== 'object') return { type: 'string' };
  const entry = {};

  if (schema.enum) {
    entry.type = 'enum';
    entry.values = schema.enum;
  } else if (schema.format === 'uuid') {
    entry.type = 'uuid';
  } else if (schema.format === 'date-time') {
    entry.type = 'datetime';
  } else if (schema.format === 'date') {
    entry.type = 'date';
  } else if (schema.format === 'email') {
    entry.type = 'email';
  } else {
    entry.type = schema.type || 'string';
  }

  const rel = schema['x-relationship'];
  if (rel?.resource) entry.relationship = rel.resource;

  const desc = descriptionOverride ?? schema.description;
  if (desc) entry.description = desc;
  return entry;
}

/** True when schema uses oneOf + discriminator (a typed variant union). */
function isDiscriminatedOneOf(schema) {
  return schema && typeof schema === 'object'
    && Array.isArray(schema.oneOf)
    && typeof schema.discriminator?.propertyName === 'string';
}

/**
 * Walk a discriminated oneOf schema, emitting base fields plain and variant-specific
 * fields annotated with appliesWhen.
 *
 * Expects each variant to follow the allOf: [base, specific] pattern:
 *   allOf[0] — shared base schema (walked once for shared fields)
 *   allOf[1] — variant additions, with a constrained type enum
 */
function walkDiscriminatedOneOf(schema, prefix, entries, visited) {
  const discriminatorProp = schema.discriminator.propertyName;

  // Emit shared/base fields from the first variant's allOf[0]
  const firstVariant = schema.oneOf[0];
  const baseSchema = firstVariant?.allOf?.[0];
  if (baseSchema) {
    walkSchema(baseSchema, prefix, entries, visited);
  }

  // Emit variant-specific fields with appliesWhen
  for (const variant of schema.oneOf) {
    const variantAdditions = variant.allOf?.[1];
    if (!variantAdditions) continue;

    const typeEnums = variantAdditions.properties?.[discriminatorProp]?.enum;
    if (!typeEnums?.length) continue; // catch-all variant — no specific constraint

    const appliesWhen = typeEnums.length === 1
      ? `${discriminatorProp} = ${typeEnums[0]}`
      : `${discriminatorProp} in [${typeEnums.join(', ')}]`;

    for (const [name, propSchema] of Object.entries(collectProps(variantAdditions))) {
      if (isInfraField(name)) continue;
      if (name === discriminatorProp) continue; // type constraint itself is handled by base

      const variantEntries = new Map();
      emitField(propSchema, `${prefix}.${name}`, variantEntries, new WeakSet());
      for (const [path, entry] of variantEntries) {
        entries.set(path, { ...entry, appliesWhen });
      }
    }
  }
}

/**
 * Returns true for fields that are API infrastructure rather than domain data:
 *   - Standard audit timestamps (createdAt, updatedAt) — universal REST convention
 */
function isInfraField(name) {
  return name === 'createdAt' || name === 'updatedAt';
}

function walkSchema(schema, prefix, entries, visited) {
  if (!schema || typeof schema !== 'object') return;
  if (visited.has(schema)) return;
  visited.add(schema);

  // Check allOf parts for any discriminated oneOf sub-schemas
  for (const part of schema.allOf || []) {
    if (isDiscriminatedOneOf(part)) {
      walkDiscriminatedOneOf(part, prefix, entries, visited);
    }
  }

  for (const [name, propSchema] of Object.entries(collectProps(schema))) {
    if (isInfraField(name)) continue;
    emitField(propSchema, `${prefix}.${name}`, entries, visited);
  }
}

/**
 * Emit one field, recursing into objects and arrays of objects.
 */
function emitField(schema, path, entries, visited) {
  if (!schema || typeof schema !== 'object') return;

  if (schema.type === 'array') {
    const items = schema.items;
    if (!items || typeof items !== 'object') return;

    if (items.enum) {
      // e.g. programsAppliedFor[], roles[]
      const entry = { type: 'enum', values: items.enum };
      if (schema.description) entry.description = schema.description;
      entries.set(`${path}[]`, entry);
    } else if (hasProps(items)) {
      // Array of objects — recurse with [] suffix; emit header when items has a known type name
      const listTypeName = items.title ?? items['x-schema-name'];
      if (listTypeName) entries.set(`${path}[]`, { type: `list(${listTypeName})` });
      if (!visited.has(items)) walkSchema(items, `${path}[]`, entries, visited);
    } else {

      // Array of scalars
      entries.set(`${path}[]`, buildLeaf(items, schema.description));
    }
    return;
  }

  if (isDiscriminatedOneOf(schema)) {
    if (!visited.has(schema)) walkDiscriminatedOneOf(schema, path, entries, visited);
    return;
  }

  if (hasProps(schema)) {
    // Nested object — emit type header if this is a named component schema, then recurse
    const typeName = schema['x-schema-name'];
    if (typeName) entries.set(path, { type: typeName });
    if (!visited.has(schema)) walkSchema(schema, path, entries, visited);
    return;
  }

  entries.set(path, buildLeaf(schema));
}

// ─── Output helpers ───────────────────────────────────────────────────────────

/** Reorder entries so uuid fields come first (identifiers and foreign keys before data fields). */
function hoistIds(entries) {
  const ids = [...entries].filter(([, v]) => v.type === 'uuid');
  if (ids.length === 0) return entries;
  const out = new Map(ids);
  for (const [k, v] of entries) { if (!out.has(k)) out.set(k, v); }
  return out;
}

/** Strip description from an entry, returning [modelEntry, description]. */
function splitEntry(entry) {
  const { description, ...rest } = entry;
  return [rest, description];
}

/** Serialize an entry to compact inline YAML matching the hand-written format: { key: value } */
function serializeEntry(entry) {
  const inner = yaml.dump(entry, { flowLevel: 0, lineWidth: -1, quotingType: "'", forceQuotes: false }).trimEnd();
  // Add spaces inside braces and ensure appliesWhen values are always single-quoted
  return inner
    .replace(/^\{/, '{ ')
    .replace(/\}$/, ' }')
    .replace(/\bappliesWhen: (?!')([^}]+?) \}/, (_, val) => `appliesWhen: '${val.trim()}' }`);
}

/** Section header comment. */
function section(title) {
  return `# ── ${title} ${'─'.repeat(Math.max(0, 76 - title.length))}`;
}

// ─── Raw spec helpers (for schema-name extraction before dereferencing) ───────

/** Extract schema name from a raw "#/components/schemas/Foo" $ref string. */
function refToSchemaName(ref) {
  return typeof ref === 'string'
    ? (ref.match(/^#\/components\/schemas\/(.+)$/)?.[1] ?? null)
    : null;
}

/**
 * Extract the schema name referenced by the 200/201 response of a raw operation.
 * Works on the un-dereferenced spec where $refs are still strings.
 */
function responseSchemaName(rawOp) {
  if (!rawOp) return null;
  const content = (rawOp.responses?.['200'] || rawOp.responses?.['201'])
    ?.content?.['application/json'];
  return refToSchemaName(content?.schema?.$ref);
}

/**
 * Extract the schema name from a raw PATCH/POST request body.
 * Works on the un-dereferenced spec where $refs are still strings.
 */
function requestBodySchemaName(rawOp) {
  if (!rawOp) return null;
  const content = rawOp.requestBody?.content?.['application/json'];
  return refToSchemaName(content?.schema?.$ref);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const specPath = join(CONTRACTS_DIR, `${domain}-openapi.yaml`);
  if (!existsSync(specPath)) {
    console.error(`Spec not found: ${specPath}`);
    process.exit(1);
  }

  // Raw spec — used to extract $ref schema names from path operations
  const rawSpec = yaml.load(readFileSync(specPath, 'utf8'));
  const rawPaths = rawSpec.paths ?? {};

  // Custom resolver: intercepts every YAML file load and annotates named schemas in memory
  // (temporary — never written to disk) so emitField can emit type headers for named objects.
  // Annotates: components.schemas entries, $defs entries, and top-level schemas with a title.
  const annotatingResolver = {
    order: 1,
    canRead(file) { return /\.ya?ml$/i.test(file.url); },
    read(file) {
      let resolvedPath;
      try { resolvedPath = fileURLToPath(file.url); } catch { resolvedPath = file.url; }
      const content = yaml.load(readFileSync(resolvedPath, 'utf8'));
      if (content && typeof content === 'object') {
        for (const [name, schema] of Object.entries(content.components?.schemas ?? {})) {
          if (schema && typeof schema === 'object') schema['x-schema-name'] = name;
        }
        for (const [name, schema] of Object.entries(content.$defs ?? {})) {
          if (schema && typeof schema === 'object') schema['x-schema-name'] = name;
        }
        if (content.title && !content['x-schema-name']) content['x-schema-name'] = content.title;
      }
      return content;
    },
  };

  console.log(`Loading ${domain}-openapi.yaml…`);
  const spec = await $RefParser.dereference(specPath, {
    dereference: { circular: 'ignore' },
    resolve: { annotatingYaml: annotatingResolver },
  });
  const schemas = spec.components?.schemas ?? {};

  // sections: [{ title, entries: Map<path, entryObject> }]
  const sections = [];

  // ── Detect root resource ──────────────────────────────────────────────────
  //
  // The root is the first /{collection}/{id} path that has a PATCH with a request body.
  // The dot-notation prefix is derived from the ID parameter name (e.g. applicationId → application).

  let rootCollection = null;
  let rootPrefix = null;
  let rootWritableSchemaName = null;

  for (const [rawPath, methods] of Object.entries(rawPaths)) {
    const match = rawPath.match(/^\/([^/]+)\/\{([^}]+)\}$/);
    if (!match) continue;
    const schemaName = requestBodySchemaName(methods.patch);
    if (!schemaName) continue;
    rootCollection = match[1];
    rootPrefix = match[2].replace(/Id$/, ''); // e.g. 'applicationId' → 'application'
    rootWritableSchemaName = schemaName;
    break;
  }

  if (!rootCollection) {
    console.error('Could not detect root resource — need a PATCH /{collection}/{id} path with a request body schema.');
    process.exit(1);
  }

  console.log(`Root resource: ${rootCollection} (prefix: ${rootPrefix}, writable schema: ${rootWritableSchemaName})`);

  // ── Scan sub-resource paths in spec order ─────────────────────────────────
  //
  // Two-pass: item paths (/{root}/{rootId}/{resource}/{resourceId}) mark a resource
  // as a collection. Remaining /{root}/{rootId}/{resource} paths are singletons.
  // Scoped to the detected rootCollection so paths from other roots are ignored.

  const resourceOrder = []; // resource names in first-seen order
  const resourceMap = new Map(); // resource → { isCollection, schemaName }

  const itemRe = new RegExp(`^\\/${rootCollection}\\/\\{[^}]+\\}\\/([^/{}]+)\\/\\{[^}]+\\}$`);
  const subRe  = new RegExp(`^\\/${rootCollection}\\/\\{[^}]+\\}\\/([^/{}]+)$`);

  for (const [rawPath, methods] of Object.entries(rawPaths)) {
    const itemMatch = rawPath.match(itemRe);
    if (itemMatch) {
      const resource = itemMatch[1];
      const schemaName = responseSchemaName(methods.get);
      if (!resourceMap.has(resource)) resourceOrder.push(resource);
      // Item path always wins (gives the single-item schema, not the List wrapper)
      if (schemaName) resourceMap.set(resource, { isCollection: true, schemaName });
      continue;
    }

    const subMatch = rawPath.match(subRe);
    if (!subMatch) continue;
    const resource = subMatch[1];
    if (resourceMap.has(resource)) continue; // item path already set it — don't downgrade

    const op = methods.get || methods.put || methods.patch;
    const schemaName = responseSchemaName(op);
    if (!schemaName) continue;
    resourceOrder.push(resource);
    resourceMap.set(resource, { isCollection: false, schemaName });
  }

  // ── Root resource fields ──────────────────────────────────────────────────
  const rootWritable = schemas[rootWritableSchemaName];
  if (rootWritable) {
    const rawEntries = new Map();
    walkSchema(rootWritable, rootPrefix, rawEntries, new WeakSet());
    const entries = hoistIds(rawEntries);
    if (entries.size > 0) sections.push({ title: rootPrefix, entries });
  }

  // ── Sub-resources (collections and singletons) ────────────────────────────
  for (const resource of resourceOrder) {
    const info = resourceMap.get(resource);
    if (!info?.schemaName || !schemas[info.schemaName]) continue;

    const camel = resource.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const prefix = info.isCollection ? `${rootPrefix}.${camel}[]` : `${rootPrefix}.${camel}`;

    const rawEntries = new Map();
    walkSchema(schemas[info.schemaName], prefix, rawEntries, new WeakSet());
    const hoisted = hoistIds(rawEntries);
    const entries = new Map();
    if (info.isCollection) entries.set(prefix, { type: `list(${info.schemaName})` });
    for (const [k, v] of hoisted) entries.set(k, v);
    if (entries.size > 0) sections.push({ title: resource, entries });
  }

  // ── Write data model (no descriptions) ───────────────────────────────────
  const modelLines = [
    `# ${domain} data model`,
    `# Generated from ${domain}-openapi.yaml`,
    `# Do not edit — regenerate with: node generate-data-model.mjs --domain=${domain}`,
    '',
  ];
  for (const { title, entries } of sections) {
    modelLines.push(section(title));
    modelLines.push('');
    for (const [path, entry] of entries) {
      const [modelEntry] = splitEntry(entry);
      modelLines.push(`${path}: ${serializeEntry(modelEntry)}`);
    }
    modelLines.push('');
  }

  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  const modelPath = join(OUTPUT_DIR, `${domain}-data-model.yaml`);
  writeFileSync(modelPath, modelLines.join('\n'), 'utf8');
  console.log(`Generated ${modelPath}`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
