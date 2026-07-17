#!/usr/bin/env node
/**
 * Annotation Field Path Validator
 *
 * Validates that schema: keys in *-annotations.yaml files resolve to real
 * fields on the corresponding OpenAPI resource schema.
 *
 * Key format: resource.field or resource.collection[].field.subfield
 *   - First segment is the resource name (lowercase, e.g. "application")
 *   - Remaining segments are the dot-separated field path
 *   - [] markers denote array traversal and are stripped for validation
 *
 * Usage:
 *   node scripts/validate-annotations.js --spec=.
 */

import { readFileSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import yaml from 'js-yaml';
import { resolveRef, collectTopLevelProperties, getPropertyAtPath, resolveSchemaRefs } from '../src/validation/state-machine-validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_SPEC_DIR = resolve(__dirname, '..');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { specDir: null, help: false };
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--spec=')) options.specDir = arg.split('=')[1];
    else { console.error(`Error: Unknown argument: ${arg}`); process.exit(1); }
  }
  return options;
}

/**
 * Build a resource schema map from all OpenAPI specs.
 * Returns: Map<resourceName (lowercase singular), { spec, schema }>
 *
 * Discovers resource names from:
 *   - schemas named like Application, ApplicationMember → application, application-member
 *   - the x-domain + schema name heuristic
 */
// Convert kebab-case path segment to camelCase (e.g. "tax-filers" → "taxFilers")
function kebabToCamel(str) {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// Register a schema under a key if not already present
function registerSchema(map, key, entry) {
  if (!map.has(key)) map.set(key, entry);
}

function resolveGetSchema(pathItem, spec, specFilePath, components) {
  const schemaRef = pathItem.get?.responses?.['200']?.content?.['application/json']?.schema;
  if (!schemaRef?.$ref) return null;
  const match = schemaRef.$ref.match(/^#\/components\/schemas\/(.+)$/);
  if (!match) return null;
  const rawSchema = components?.[match[1]];
  if (!rawSchema) return null;
  return { schema: resolveSchemaRefs(rawSchema, { spec, specFilePath }), spec };
}

export function buildResourceSchemaMap(specsDir) {
  const map = new Map(); // resourceKey → { spec, schema }

  let files;
  try { files = readdirSync(specsDir); } catch { return map; }

  for (const file of files) {
    if (!file.endsWith('-openapi.yaml')) continue;
    const specFilePath = join(specsDir, file);
    let spec;
    try { spec = yaml.load(readFileSync(specFilePath, 'utf8')); } catch { continue; }

    if (!spec?.components?.schemas) continue;
    const components = spec.components.schemas;

    const allPaths = Object.keys(spec.paths || {});

    for (const [path, pathItem] of Object.entries(spec.paths || {})) {
      const segments = path.split('/').filter(Boolean);
      const lastSeg = segments[segments.length - 1];
      const nonParamSegs = segments.filter(s => !s.startsWith('{'));
      if (nonParamSegs.length === 0) continue;
      const lastNonParamSeg = nonParamSegs[nonParamSegs.length - 1];
      const hasParentParam = segments.slice(0, -1).some(s => s.startsWith('{'));

      if (lastSeg.startsWith('{')) {
        // Detail endpoint: register under singular kebab key (e.g. "tax-filer")
        // and camelCase plural key (e.g. "taxFilers") for annotation path traversal
        const singularKey = lastNonParamSeg.replace(/s$/, '');
        const camelPluralKey = kebabToCamel(lastNonParamSeg);
        const entry = resolveGetSchema(pathItem, spec, specFilePath, components);
        if (entry) {
          registerSchema(map, singularKey, entry);
          registerSchema(map, camelPluralKey, entry);
        }
      } else if (hasParentParam) {
        // Might be a singleton sub-resource (e.g. /applications/{id}/household-info)
        // or a collection list (e.g. /applications/{id}/tax-filers).
        // Only register singletons; collection lists have a companion detail path.
        const hasDetailCompanion = allPaths.some(
          p => p.startsWith(path + '/') && /^\{[^}]+\}$/.test(p.slice(path.length + 1))
        );
        if (!hasDetailCompanion) {
          const camelKey = kebabToCamel(lastSeg);
          const entry = resolveGetSchema(pathItem, spec, specFilePath, components);
          if (entry) registerSchema(map, camelKey, entry);
        }
      }
      // else: top-level list/collection endpoint — skip (list schema ≠ resource schema)
    }

    // Schema name heuristic fills in anything not covered by paths:
    // Application → "application", ApplicationMember → "application-member"
    for (const [name, rawSchema] of Object.entries(components)) {
      const resourceKey = name
        .replace(/([A-Z])/g, (m, c, i) => (i > 0 ? '-' : '') + c.toLowerCase())
        .replace(/^-/, '');
      if (!map.has(resourceKey)) {
        const schema = resolveSchemaRefs(rawSchema, { spec, specFilePath });
        map.set(resourceKey, { spec, schema });
      }
    }
  }

  return map;
}

/**
 * Validate a single annotation path key against the resource schema map.
 * Path format: "resource.field" or "resource.collection[].field.subfield"
 *
 * Returns null on success, or an error message string on failure.
 */
export function validateAnnotationPath(pathKey, resourceSchemaMap) {
  // Strip [] array markers
  const parts = pathKey.replace(/\[\]/g, '').split('.').filter(Boolean);

  if (parts.length < 1) return `Empty path key`;

  const resourceName = parts[0];
  let entry = resourceSchemaMap.get(resourceName);
  if (!entry) {
    return resourceSchemaMap.size > 0
      ? `Resource "${resourceName}" not found in any OpenAPI spec`
      : null;
  }

  if (parts.length === 1) return null; // Annotating the top-level resource — OK

  let { spec, schema } = entry;

  // Walk each segment. collectTopLevelProperties handles allOf/oneOf/anyOf recursively,
  // which is needed for polymorphic schemas (e.g. health.yaml oneOf variants). If a
  // segment isn't a property at any level, try it as a sub-resource map key instead.
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];

    // Collect all properties at this schema level, including through combinators
    const allProps = collectTopLevelProperties(spec, schema);
    if (allProps.has(part)) {
      schema = allProps.get(part);
      continue;
    }

    // Not a direct property — try inside array items (for paths like someArray[].field)
    if (schema.items) {
      const items = schema.items?.$ref ? (resolveRef(spec, schema.items.$ref) ?? schema.items) : schema.items;
      const itemProps = collectTopLevelProperties(spec, items);
      if (itemProps.has(part)) {
        schema = itemProps.get(part);
        continue;
      }
    }

    // Try as sub-resource key (e.g. "taxFilers", "householdInfo")
    const subEntry = resourceSchemaMap.get(part);
    if (subEntry) {
      spec = subEntry.spec;
      schema = subEntry.schema;
      continue;
    }

    return `Field path "${parts.slice(1).join('.')}" does not exist on resource "${resourceName}"`;
  }

  return null;
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    console.log('Usage: node scripts/validate-annotations.js --spec=<dir>');
    process.exit(0);
  }

  const specDir = resolve(options.specDir || DEFAULT_SPEC_DIR);

  console.log('='.repeat(70));
  console.log('Annotation Field Path Validator');
  console.log('='.repeat(70));
  console.log(`  Directory: ${specDir}\n`);

  let files;
  try { files = readdirSync(specDir); } catch {
    console.error(`  Cannot read directory: ${specDir}`);
    process.exit(1);
  }

  // Discover annotation files by $schema, not filename convention
  const annotationFiles = [];
  for (const file of files) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
    const filePath = join(specDir, file);
    try {
      const doc = yaml.load(readFileSync(filePath, 'utf8'));
      const schemaBasename = doc?.$schema?.split('/').pop();
      if (schemaBasename === 'annotations-schema.yaml') {
        annotationFiles.push({ file, filePath, doc });
      }
    } catch {
      // unparseable files — caught per-file below
    }
  }

  if (annotationFiles.length === 0) {
    console.log('  No annotation files found. Nothing to validate.\n');
    process.exit(0);
  }

  console.log(`  Found ${annotationFiles.length} annotation file(s)\n`);

  const resourceSchemaMap = buildResourceSchemaMap(specDir);

  let totalErrors = 0;

  for (const { file, filePath, doc: preloaded } of annotationFiles) {
    let doc;
    try {
      doc = preloaded ?? yaml.load(readFileSync(filePath, 'utf8'));
    } catch (err) {
      console.error(`  ✗ ${file}`);
      console.error(`      Parse error: ${err.message}`);
      totalErrors++;
      continue;
    }

    const schemaKeys = Object.keys(doc?.schema || {});
    const fileErrors = [];

    for (const pathKey of schemaKeys) {
      const err = validateAnnotationPath(pathKey, resourceSchemaMap);
      if (err) fileErrors.push({ pathKey, message: err });
    }

    if (fileErrors.length === 0) {
      console.log(`  ✓ ${file} (${schemaKeys.length} paths)`);
    } else {
      console.error(`  ✗ ${file}`);
      for (const { pathKey, message } of fileErrors) {
        console.error(`      ${message}`);
        console.error(`        at: schema["${pathKey}"]`);
      }
      totalErrors += fileErrors.length;
    }
  }

  console.log('');

  if (totalErrors > 0) {
    console.error(`Annotation validation failed with ${totalErrors} error(s).`);
    process.exit(1);
  }

  console.log('Annotation validation passed.');
}

main();
