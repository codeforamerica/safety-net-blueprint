#!/usr/bin/env node
/**
 * generate-field-inventory.mjs
 *
 * Generates a domain field inventory YAML in dot-notation from an OpenAPI spec.
 * Walks schemas reachable from the spec, emitting one line per leaf field.
 *
 * Usage:
 *   node generate-field-inventory.mjs --domain=intake
 *   node generate-field-inventory.mjs --spec=path/to/spec.yaml [--overlay=path/to/overlay.yaml] [--out=output.yaml]
 *   node generate-field-inventory.mjs --spec=path/to/specs/ [--overlay=path/to/overlays/] [--out=path/to/output/]
 *   node generate-field-inventory.mjs --domain=intake --spec=path/to/specs/ [--overlay=...] [--out=...]
 *
 * Flags:
 *   --domain    Domain name filter. Without --spec, looks for {domain}-openapi.yaml in CONTRACTS_DIR.
 *               With --spec=<folder>, filters specs in that folder whose filename includes the domain.
 *   --spec      Path to an OpenAPI file or a folder of OpenAPI files.
 *               Defaults to CONTRACTS_DIR when --domain is given without --spec.
 *   --overlay   Path to an overlay file or folder of overlay files to apply before generating.
 *   --out       Output file path (single spec) or directory. Defaults to output/{stem}-field-inventory.yaml.
 */

import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, readdirSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join, resolve, basename, sep } from 'path';
import yaml from 'js-yaml';
import $RefParser from '@apidevtools/json-schema-ref-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONTRACTS_DIR = resolve(__dirname, '../../contracts');
const OUTPUT_DIR = join(__dirname, 'output');
const PROJECT_ROOT = resolve(__dirname, '../../..');
const RESOLVE_SCRIPT = resolve(__dirname, '../../contracts/scripts/resolve.js');

// ─── Overlay stripping ────────────────────────────────────────────────────────

// Remove x-relationship.style from any update/add/append values in an overlay.
// The relationship resolver correctly handles request schemas (no links added),
// but we strip style overrides defensively so the resolver sees only the base
// x-relationship annotations without explicit expand/include hints.
function stripStyleFromValue(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stripStyleFromValue);
  const result = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === 'x-relationship' && v && typeof v === 'object' && !Array.isArray(v)) {
      const { style, ...rest } = v;
      if (Object.keys(rest).length > 0) result[k] = rest;
      // x-relationship had only style — drop the annotation entirely
    } else {
      result[k] = stripStyleFromValue(v);
    }
  }
  return result;
}

function stripRelationshipStyles(overlay) {
  if (!overlay?.actions) return overlay;
  return {
    ...overlay,
    actions: overlay.actions.map(action => {
      const stripped = { ...action };
      for (const key of ['update', 'add', 'append']) {
        if (stripped[key] != null) stripped[key] = stripStyleFromValue(stripped[key]);
      }
      return stripped;
    }),
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const cliArgs = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const eq = a.indexOf('=');
      return eq >= 0 ? [a.slice(2, eq), a.slice(eq + 1)] : [a.slice(2), true];
    })
);

const { domain, spec: specArg, overlay: overlayArg, out: outArg } = cliArgs;

if (!domain && !specArg) {
  console.error('Usage: node generate-field-inventory.mjs --domain=<domain>');
  console.error('       node generate-field-inventory.mjs --spec=<file-or-folder> [--overlay=<file-or-folder>] [--out=<file-or-folder>]');
  process.exit(1);
}

// ─── Input/output resolution ──────────────────────────────────────────────────

/** Resolve the list of spec file paths to process. */
function resolveSpecPaths() {
  // No --spec: use CONTRACTS_DIR (filtered by --domain if given)
  const searchDir = specArg ? resolve(specArg) : CONTRACTS_DIR;
  const stat = specArg ? statSync(searchDir, { throwIfNoEntry: false }) : null;

  if (specArg && !stat) {
    console.error(`Spec path not found: ${searchDir}`);
    process.exit(1);
  }

  // Single file
  if (stat?.isFile()) return [searchDir];

  // Folder (or default CONTRACTS_DIR): find all *-openapi.yaml files
  let files = readdirSync(searchDir)
    .filter(f => f.endsWith('-openapi.yaml') && !f.endsWith('-openapi-examples.yaml'));

  if (domain) {
    files = files.filter(f => f.includes(domain));
  }

  if (files.length === 0) {
    const hint = domain ? ` matching domain "${domain}"` : '';
    console.error(`No *-openapi.yaml files found${hint} in ${searchDir}`);
    process.exit(1);
  }

  return files.map(f => join(searchDir, f));
}

/** Resolve the list of overlay file paths to apply. */
function resolveOverlayPaths() {
  if (!overlayArg) return [];

  const overlayPath = resolve(overlayArg);
  const stat = statSync(overlayPath, { throwIfNoEntry: false });

  if (!stat) {
    console.error(`Overlay path not found: ${overlayPath}`);
    process.exit(1);
  }

  if (stat.isFile()) return [overlayPath];

  return readdirSync(overlayPath)
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .sort()
    .map(f => join(overlayPath, f));
}

/**
 * Resolve the output file path for a given spec.
 * If --out ends with .yaml/.yml, use it as-is (explicit file).
 * If --out is a directory path, derive the filename from the spec stem.
 * If --out is omitted, write to the default output/ dir.
 */
function resolveOutputPath(specPath) {
  const stem = basename(specPath).replace(/-openapi\.ya?ml$/, '');
  const filename = `${stem}-field-inventory.yaml`;

  if (!outArg) return join(OUTPUT_DIR, filename);

  const outPath = resolve(outArg);
  if (outPath.endsWith('.yaml') || outPath.endsWith('.yml')) return outPath;
  return join(outPath, filename);
}

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
      // Array of objects — recurse with [] suffix; always emit header
      const listTypeName = items.title ?? items['x-schema-name'];
      entries.set(`${path}[]`, listTypeName ? { type: `list(${listTypeName})` } : { type: 'list' });
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

  // x-relationship fields are FK references. Treat as leaf regardless of whether
  // the resolved spec has inlined the related object (e.g. via style: expand).
  // The field inventory describes schema structure, not resolution artifacts.
  if (schema['x-relationship']?.resource) {
    entries.set(path, buildLeaf(schema));
    return;
  }

  if (hasProps(schema)) {
    // Nested object — always emit type header, then recurse
    const typeName = schema['x-schema-name'] ?? schema.title;
    entries.set(path, typeName ? { type: typeName } : { type: 'object' });
    if (!visited.has(schema)) walkSchema(schema, path, entries, visited);
    return;
  }

  entries.set(path, buildLeaf(schema));
}

// ─── Output helpers ───────────────────────────────────────────────────────────

/** Reorder entries so uuid fields come first within each parent namespace.
 *  Builds a tree, sorts each node's direct children (uuids before others),
 *  then flattens depth-first so parent entries always precede their children. */
function hoistIds(entries) {
  const keySet = new Set(entries.keys());

  // Build child lists: parent is the nearest ancestor key that exists in entries,
  // or null for true roots (no ancestor in the map).
  const children = new Map(); // parentKey|null → [key, ...]
  const roots = [];
  for (const key of entries.keys()) {
    const lastDot = key.lastIndexOf('.');
    const parentPath = lastDot === -1 ? null : key.slice(0, lastDot);
    const parent = parentPath !== null && keySet.has(parentPath) ? parentPath : null;
    if (parent === null) {
      roots.push(key);
    } else {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(key);
    }
  }

  // Sort each group: uuids first, then others (stable within each group)
  function sortGroup(keys) {
    keys.sort((a, b) => {
      const aUuid = entries.get(a)?.type === 'uuid' ? 0 : 1;
      const bUuid = entries.get(b)?.type === 'uuid' ? 0 : 1;
      return aUuid - bUuid;
    });
  }
  sortGroup(roots);
  for (const kids of children.values()) sortGroup(kids);

  // DFS: emit parent, then recurse into children
  const out = new Map();
  function emit(key) {
    out.set(key, entries.get(key));
    for (const child of children.get(key) ?? []) emit(child);
  }
  for (const key of roots) emit(key);
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

// ─── Per-spec processing ──────────────────────────────────────────────────────

async function processSpec(specPath, overlayPaths, outputPath) {
  const specFilename = basename(specPath);
  const stem = specFilename.replace(/-openapi\.ya?ml$/, '');
  const resolvedSpecPath = resolve(specPath);
  // When given a single spec file, run resolve against its parent directory so
  // state machine files and other companions in the same folder are included.
  const specDir = statSync(resolvedSpecPath).isDirectory() ? resolvedSpecPath : dirname(resolvedSpecPath);

  // Run the real resolve pipeline. This applies overlays, injects x-enum-source
  // enum values from state machines, and resolves relationships. We write the
  // results to a temp dir and swap the root spec content into $RefParser via a
  // custom resolver, preserving the original spec path as the base URL so
  // external $refs (e.g. ./schemas/domain.yaml) continue to resolve correctly.
  const tempDir = mkdtempSync(join(tmpdir(), 'field-inventory-'));
  let rawPaths = {};
  let spec = null;

  try {
    const resolvedSpecDir = join(tempDir, 'resolved');

    // Strip x-relationship.style from overlays before passing to resolve.
    // This prevents explicit expand/include overrides from affecting schema
    // structure; the resolver already enforces links-only on request schemas.
    let tempOverlayArg = null;
    if (overlayPaths.length > 0) {
      const tempOverlayDir = join(tempDir, 'overlay');
      mkdirSync(tempOverlayDir, { recursive: true });
      for (const op of overlayPaths) {
        const raw = yaml.load(readFileSync(op, 'utf8'), { schema: yaml.CORE_SCHEMA });
        const stripped = stripRelationshipStyles(raw);
        writeFileSync(join(tempOverlayDir, basename(op)), yaml.dump(stripped, { schema: yaml.CORE_SCHEMA, lineWidth: -1 }), 'utf8');
      }
      tempOverlayArg = tempOverlayDir;
    }

    const resolveArgs = [`--spec=${specDir}`, `--out=${resolvedSpecDir}`];
    if (tempOverlayArg) resolveArgs.push(`--overlay=${tempOverlayArg}`);

    const result = spawnSync(process.execPath, [RESOLVE_SCRIPT, ...resolveArgs], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.status !== 0) {
      throw new Error(`resolve failed:\n${result.stderr || result.stdout}`);
    }

    // Use the resolved spec file as the base URL for $RefParser so that external
    // $refs (e.g. ./schemas/domain/intake.yaml) resolve against the resolved
    // copies in the temp dir — which have overlays applied — rather than the
    // original source files. The temp dir must still exist during dereference.
    const resolvedSpecFile = join(resolvedSpecDir, specFilename);
    const baseUrl = existsSync(resolvedSpecFile) ? resolvedSpecFile : specPath;
    const resolvedOrOriginal = existsSync(resolvedSpecFile)
      ? readFileSync(resolvedSpecFile, 'utf8')
      : readFileSync(specPath, 'utf8');

    // Parse twice: rawPaths needs $ref strings intact for root-resource detection,
    // but $RefParser.dereference mutates the object it receives in-place.
    rawPaths = (yaml.load(resolvedOrOriginal, { schema: yaml.CORE_SCHEMA })).paths ?? {};

    console.log(`Loading ${specFilename}…`);
    spec = await $RefParser.dereference(
      baseUrl,
      yaml.load(resolvedOrOriginal, { schema: yaml.CORE_SCHEMA }),
      { dereference: { circular: 'ignore' } }
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  // Annotate components.schemas with x-schema-name so emitField can emit type
  // headers for named objects. Done post-dereference since $RefParser has fully
  // resolved all external $refs into spec.components.schemas by this point.
  for (const [name, schema] of Object.entries(spec?.components?.schemas ?? {})) {
    if (schema && typeof schema === 'object' && !schema['x-schema-name']) {
      schema['x-schema-name'] = name;
    }
  }

  const schemas = spec.components?.schemas ?? {};

  // sections: [{ title, entries: Map<path, entryObject> }]
  const sections = [];

  // ── Detect all root resources ─────────────────────────────────────────────
  //
  // A root is any /{collection}/{id} path with a PATCH that has a request body.
  // The dot-notation prefix is derived from the ID parameter name (e.g. applicationId → application).
  // Domains with multiple top-level resources (e.g. workflow: queues + tasks) produce
  // one section per root plus their respective sub-resources.

  const roots = [];
  for (const [rawPath, methods] of Object.entries(rawPaths)) {
    const match = rawPath.match(/^\/([^/]+)\/\{([^}]+)\}$/);
    if (!match) continue;
    const schemaName = requestBodySchemaName(methods.patch);
    if (!schemaName) continue;
    roots.push({
      collection: match[1],
      prefix: match[2].replace(/Id$/, ''), // e.g. 'applicationId' → 'application'
      writableSchemaName: schemaName,
    });
  }

  if (roots.length === 0) {
    console.warn(`  ${specFilename}: no root resource found (need PATCH /{collection}/{id} with request body) — skipping`);
    return;
  }

  for (const { collection: rootCollection, prefix: rootPrefix, writableSchemaName: rootWritableSchemaName } of roots) {
    console.log(`  Root resource: ${rootCollection} (prefix: ${rootPrefix}, writable schema: ${rootWritableSchemaName})`);

    // ── Scan sub-resource paths in spec order ───────────────────────────────
    //
    // Two-pass: item paths (/{root}/{rootId}/{resource}/{resourceId}) mark a resource
    // as a collection. Remaining /{root}/{rootId}/{resource} paths are singletons.
    // Scoped to this root so paths from other roots are ignored.

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

    // ── Root resource fields ──────────────────────────────────────────────
    const rootWritable = schemas[rootWritableSchemaName];
    if (rootWritable) {
      const rawEntries = new Map();
      walkSchema(rootWritable, rootPrefix, rawEntries, new WeakSet());
      const entries = hoistIds(rawEntries);
      if (entries.size > 0) sections.push({ title: rootPrefix, entries });
    }

    // ── Sub-resources (collections and singletons) ────────────────────────
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
  }

  // ── Write field inventory (no descriptions) ───────────────────────────────
  const overlayNote = overlayPaths.length > 0 ? ` + ${overlayPaths.length} overlay(s)` : '';
  const lines = [
    `# ${stem} field inventory`,
    `# Generated from ${specFilename}${overlayNote}`,
    `# Do not edit — regenerate with: node generate-field-inventory.mjs --domain=${stem}`,
    '',
  ];
  for (const { title, entries } of sections) {
    lines.push(section(title));
    lines.push('');
    for (const [path, entry] of entries) {
      const [modelEntry] = splitEntry(entry);
      lines.push(`${path}: ${serializeEntry(modelEntry)}`);
    }
    lines.push('');
  }

  const outDir = dirname(outputPath);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(outputPath, lines.join('\n'), 'utf8');
  console.log(`  Generated ${outputPath}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const specPaths = resolveSpecPaths();
  const overlayPaths = resolveOverlayPaths();

  for (const specPath of specPaths) {
    const outputPath = resolveOutputPath(specPath);
    await processSpec(specPath, overlayPaths, outputPath);
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
