#!/usr/bin/env node
/**
 * Rules File Validation Script
 *
 * Validates cross-artifact references in *-rules.yaml files:
 * - Entity paths (domain/resource) must resolve to a discoverable API resource
 * - "from" field paths must exist as schema properties on the calling resource
 *   or on a previously resolved entity (chaining support)
 *
 * Structural validation (required fields, types, patterns) is handled by
 * validate-schemas.js via the JSON Schema declared in each rules file's $schema.
 */

import { readFileSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// =============================================================================
// OpenAPI resource index
// =============================================================================

/**
 * Resolve an internal $ref pointer (e.g., "#/components/schemas/Task") in a parsed spec.
 * @param {Object} spec - Parsed OpenAPI spec object
 * @param {string} ref - Internal $ref string starting with "#/"
 * @returns {Object|null} Resolved object or null if not found
 */
function resolveInternalRef(spec, ref) {
  if (!ref.startsWith('#/')) return null;
  const parts = ref.slice(2).split('/');
  let node = spec;
  for (const part of parts) {
    if (node == null || typeof node !== 'object') return null;
    node = node[part];
  }
  return node || null;
}

/**
 * Extract the set of property names from a schema object.
 * Follows allOf/oneOf/anyOf and internal $ref. External $ref are skipped.
 * @param {Object} spec - Parsed OpenAPI spec (for $ref resolution)
 * @param {Object} schema - Schema object to extract properties from
 * @param {number} [depth=0] - Recursion guard
 * @returns {Set<string>} Set of property names
 */
function extractSchemaProperties(spec, schema, depth = 0) {
  const props = new Set();
  if (!schema || depth > 5) return props;

  if (schema.$ref) {
    const resolved = resolveInternalRef(spec, schema.$ref);
    if (resolved) {
      for (const p of extractSchemaProperties(spec, resolved, depth + 1)) props.add(p);
    }
    return props;
  }

  if (schema.properties) {
    for (const key of Object.keys(schema.properties)) props.add(key);
  }

  for (const combinator of ['allOf', 'oneOf', 'anyOf']) {
    for (const sub of schema[combinator] || []) {
      for (const p of extractSchemaProperties(spec, sub, depth + 1)) props.add(p);
    }
  }

  return props;
}

/**
 * Build an index of discoverable API resources from all OpenAPI specs in a directory.
 * Each entry maps 'domain/collection' → Set of schema property names.
 *
 * Discovery logic:
 * - domain: from info.x-domain
 * - collection: from paths matching /{collection} (first path segment, no ID)
 * - schema: from the GET /{collection}/{id} 200 response body $ref
 *
 * @param {string} specsDir - Directory containing *-openapi.yaml files
 * @returns {Map<string, Set<string>>} Map of 'domain/collection' → property names
 */
function buildResourceIndex(specsDir) {
  const index = new Map();
  let files;
  try {
    files = readdirSync(specsDir);
  } catch {
    return index;
  }

  for (const file of files) {
    if (!file.endsWith('-openapi.yaml')) continue;

    const filePath = join(specsDir, file);
    let spec;
    try {
      spec = yaml.load(readFileSync(filePath, 'utf8'));
    } catch {
      continue;
    }

    const domain = spec?.info?.['x-domain'];
    if (!domain || !spec.paths) continue;

    // Find all collection paths: exactly one segment (e.g., /tasks, /applications)
    for (const [path, pathItem] of Object.entries(spec.paths)) {
      const segments = path.split('/').filter(Boolean);
      if (segments.length !== 1 || segments[0].startsWith('{')) continue;

      const collection = segments[0];
      const key = `${domain}/${collection}`;

      // Default: register with empty property set (entity exists, schema unknown)
      if (!index.has(key)) index.set(key, new Set());

      // Try to find schema properties from GET /{collection}/{id} response
      const idPath = `${path}/{${collection.replace(/s$/, '')}Id}`;
      const altIdPath = Object.keys(spec.paths).find(
        p => p.startsWith(path + '/') && p.includes('{') && p.split('/').length === 3
      );
      const itemPathItem = spec.paths[idPath] || (altIdPath && spec.paths[altIdPath]);

      if (itemPathItem?.get?.responses?.['200']) {
        const responseContent = itemPathItem.get.responses['200'].content?.['application/json'];
        const schemaRef = responseContent?.schema;
        if (schemaRef) {
          const schemaObj = schemaRef.$ref
            ? resolveInternalRef(spec, schemaRef.$ref)
            : schemaRef;
          if (schemaObj) {
            const props = extractSchemaProperties(spec, schemaObj);
            index.set(key, props);
          }
        }
      }
    }
  }

  return index;
}

// =============================================================================
// Rules file discovery
// =============================================================================

/**
 * Discover and parse all *-rules.yaml files in a directory.
 * @param {string} specsDir
 * @returns {Array<{ filePath: string, rules: Object }>}
 */
function discoverRulesFiles(specsDir) {
  let files;
  try {
    files = readdirSync(specsDir);
  } catch {
    return [];
  }

  const results = [];
  for (const file of files) {
    if (!file.endsWith('-rules.yaml')) continue;
    const filePath = join(specsDir, file);
    try {
      const rules = yaml.load(readFileSync(filePath, 'utf8'));
      if (rules) results.push({ filePath, rules });
    } catch (err) {
      results.push({ filePath, parseError: err.message });
    }
  }
  return results;
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate a single rules file against the resource index.
 * @param {string} filePath
 * @param {Object} rules - Parsed rules YAML
 * @param {Map<string, Set<string>>} resourceIndex
 * @returns {string[]} Array of error messages (empty = valid)
 */
function validateRulesFile(filePath, rules, resourceIndex) {
  const errors = [];
  const label = filePath.split('/').pop();

  if (!rules.resource) return errors; // structural check handled by validate-schemas.js

  const callingResource = rules.resource; // e.g., "workflow/tasks"
  const callingProps = resourceIndex.get(callingResource) ?? null;

  if (!resourceIndex.has(callingResource)) {
    errors.push(`${label}: resource "${callingResource}" does not match any discoverable API resource`);
  }

  for (const ruleSet of rules.ruleSets || []) {
    // Schema for entities resolved so far (for chaining validation)
    // key = alias, value = Set of property names
    const resolvedSchemas = new Map();

    for (const binding of ruleSet.context || []) {
      if (!binding.as || !binding.from) continue;

      // Extract dot-path string from from field.
      // Accepts bare string ("subjectId") or JSON Logic {var: "path"} form.
      // Complex JSON Logic expressions (non-var) are skipped — no static path to validate.
      const fromPath = typeof binding.from === 'string'
        ? binding.from
        : (typeof binding.from?.var === 'string' ? binding.from.var : null);

      // 1. Validate entity path exists (entity bindings only — collection bindings have no entity)
      if (binding.entity) {
        if (!resourceIndex.has(binding.entity)) {
          errors.push(
            `${label} ruleSet "${ruleSet.id}": entity "${binding.entity}" does not match any discoverable API resource`
          );
        } else {
          // Register this entity's schema for chaining validation
          resolvedSchemas.set(binding.as, resourceIndex.get(binding.entity));
        }
      }

      // 2. Validate from path exists on the calling resource or a previously resolved entity.
      // Skip for:
      //   - event-triggered rule sets: "this" is the event envelope, not the calling resource schema
      //   - complex JSON Logic expressions: no static dot-path to validate
      if (ruleSet.on || fromPath === null) continue;

      const fromParts = fromPath.split('.');
      const fromRoot = fromParts[0];
      const fromField = fromParts.length > 1 ? fromParts.slice(1).join('.') : null;

      if (fromField) {
        // Chained path: root is an alias of a previously resolved entity
        const chainSchema = resolvedSchemas.get(fromRoot);
        if (!chainSchema) {
          errors.push(
            `${label} ruleSet "${ruleSet.id}" binding "${binding.as}": ` +
            `"from" path "${fromPath}" references "${fromRoot}" which is not a previously resolved entity alias`
          );
        } else if (chainSchema.size > 0 && !chainSchema.has(fromField)) {
          errors.push(
            `${label} ruleSet "${ruleSet.id}" binding "${binding.as}": ` +
            `"from" path "${fromPath}" — field "${fromField}" not found on "${fromRoot}" schema`
          );
        }
      } else {
        // Simple path: must exist on calling resource schema
        if (callingProps !== null && callingProps.size > 0 && !callingProps.has(fromRoot)) {
          errors.push(
            `${label} ruleSet "${ruleSet.id}" binding "${binding.as}": ` +
            `"from" field "${fromRoot}" not found on calling resource schema "${callingResource}"`
          );
        }
      }
    }
  }

  return errors;
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log('Rules File Validator\n');
    console.log('Usage: node scripts/validate-rules.js --spec=<dir>\n');
    console.log('Validates cross-artifact references in *-rules.yaml files:');
    console.log('  - entity paths resolve to discoverable API resources');
    console.log('  - from field paths exist on the calling resource schema\n');
    console.log('Flags:');
    console.log('  --spec=<dir>  Path to contracts directory (required)');
    console.log('  -h, --help    Show this help message');
    process.exit(0);
  }

  const unknown = args.filter(a => a !== '--help' && a !== '-h' && !a.startsWith('--spec='));
  if (unknown.length > 0) {
    console.error(`Error: Unknown argument(s): ${unknown.join(', ')}`);
    process.exit(1);
  }

  const specArg = args.find(a => a.startsWith('--spec='));
  if (!specArg) {
    console.error('Error: --spec=<dir> is required.');
    process.exit(1);
  }

  const specsDir = resolve(specArg.split('=')[1]);
  const resourceIndex = buildResourceIndex(specsDir);
  const rulesFiles = discoverRulesFiles(specsDir);

  if (rulesFiles.length === 0) {
    console.log('No *-rules.yaml files found.');
    process.exit(0);
  }

  const allErrors = [];

  for (const { filePath, rules, parseError } of rulesFiles) {
    if (parseError) {
      allErrors.push(`${filePath.split('/').pop()}: parse error — ${parseError}`);
      continue;
    }
    const errors = validateRulesFile(filePath, rules, resourceIndex);
    allErrors.push(...errors);
  }

  if (allErrors.length === 0) {
    console.log(`✓ Rules validation passed (${rulesFiles.length} file(s) checked)`);
    process.exit(0);
  } else {
    console.error(`Rules validation failed with ${allErrors.length} error(s):\n`);
    for (const err of allErrors) {
      console.error(`  ✗ ${err}`);
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
