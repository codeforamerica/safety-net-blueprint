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

import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join, relative, isAbsolute, basename } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import yaml from 'js-yaml';
import { resolveRef, collectTopLevelProperties, getPropertyAtPath, resolveSchemaRefs } from '@codeforamerica/blueprint-core/state-machine-validator';

function walkForPattern(dir, suffix) {
  const results = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return results; }
  for (const entry of entries) {
    if (entry.startsWith('.') || entry === 'node_modules') continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) results.push(...walkForPattern(fullPath, suffix));
    else if (stat.isFile() && entry.endsWith(suffix)) results.push(fullPath);
  }
  return results;
}



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

  for (const specFilePath of walkForPattern(specsDir, '-openapi.yaml')) {
    let spec;
    try { spec = yaml.load(readFileSync(specFilePath, 'utf8'), { schema: yaml.DEFAULT_SCHEMA }); } catch { continue; }

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
 * Build an index of valid operation keys from all state machine files.
 * Keys are formatted as "<object-lowercase>.<action-id>" (e.g. "application.submit").
 * Returns a Set<string>.
 */
export function buildStateMachineActionIndex(specsDir) {
  const index = new Set();

  for (const filePath of walkForPattern(specsDir, '-state-machine.yaml')) {
    let doc;
    try { doc = yaml.load(readFileSync(filePath, 'utf8'), { schema: yaml.CORE_SCHEMA }); } catch { continue; }

    for (const machine of doc?.machines || []) {
      if (!machine.object) continue;
      const objectKey = machine.object.toLowerCase();
      for (const action of machine.actions || []) {
        if (action.id) index.add(`${objectKey}.${action.id}`);
      }
    }
  }

  return index;
}

/**
 * Validate a single annotation operation key against the state machine action index.
 * Key format: "object.action-id" (e.g. "application.submit").
 *
 * Returns null on success, or an error message string on failure.
 */
export function validateAnnotationOperation(operationKey, actionIndex) {
  if (actionIndex.size === 0) return null; // no state machines loaded — skip
  if (!actionIndex.has(operationKey)) {
    return `Operation "${operationKey}" does not match any declared state machine action`;
  }
  return null;
}

/**
 * Build an index of valid policy IDs from all policy registry files.
 * Returns a Set<string>.
 */
export function buildPolicyIndex(specsDir) {
  const index = new Set();

  for (const filePath of walkForPattern(specsDir, '-registry-policies.yaml')) {
    let doc;
    try { doc = yaml.load(readFileSync(filePath, 'utf8'), { schema: yaml.CORE_SCHEMA }); } catch { continue; }

    for (const policyId of Object.keys(doc?.policies || {})) {
      index.add(policyId);
    }
  }

  return index;
}

/**
 * Validate all policy citations in an annotation document against the policy index.
 * Checks schema, operations, and events sections.
 *
 * Returns an array of error message strings (empty if all citations are valid).
 */
export function validateAnnotationPolicyCitations(annotationDoc, policyIndex) {
  if (policyIndex.size === 0) return []; // no policies loaded — skip

  const errors = [];

  function checkSection(sectionName, section) {
    for (const [key, entry] of Object.entries(section || {})) {
      for (const policyId of entry?.policies || []) {
        if (!policyIndex.has(policyId)) {
          errors.push(`Policy "${policyId}" cited at ${sectionName}["${key}"] not found in policy registry`);
        }
      }
    }
  }

  checkSection('schema', annotationDoc?.schema);
  checkSection('operations', annotationDoc?.operations);
  checkSection('events', annotationDoc?.events);

  return errors;
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

/**
 * Build an AsyncAPI channel index from all *-asyncapi.yaml files.
 * Returns:
 *   byFile: Map<filename, Set<channelKey>> — for validating emit steps against a specific spec
 *   all:    Set<channelKey>                — for validating subscription steps across all domains
 */
export function buildAsyncApiChannelIndex(specsDir) {
  const byFile = new Map();
  const all = new Set();

  for (const filePath of walkForPattern(specsDir, '-asyncapi.yaml')) {
    let doc;
    try { doc = yaml.load(readFileSync(filePath, 'utf8'), { schema: yaml.CORE_SCHEMA }); } catch { continue; }

    const channels = new Set(Object.keys(doc?.channels || {}));
    byFile.set(basename(filePath), channels);
    for (const ch of channels) all.add(ch);
  }

  return { byFile, all };
}

/**
 * Recursively collect all emit type values from a state machine document.
 * Returns an array of { type, path } for each emit step found.
 */
function collectEmitSteps(node, path = '') {
  const results = [];
  if (!node || typeof node !== 'object') return results;
  if (Array.isArray(node)) {
    node.forEach((item, i) => results.push(...collectEmitSteps(item, `${path}[${i}]`)));
    return results;
  }
  if ('emit' in node && node.emit?.type) {
    results.push({ type: node.emit.type, path: `${path}.emit` });
  }
  for (const [key, val] of Object.entries(node)) {
    if (key !== 'emit') results.push(...collectEmitSteps(val, `${path}.${key}`));
  }
  return results;
}

/**
 * Collect all event subscription type values from a state machine document.
 * Subscriptions are arrays of { type: '...' } objects under each machine's events.
 */
function collectSubscriptionTypes(doc) {
  const types = [];
  for (const machine of doc?.machines || []) {
    for (const event of machine.events || []) {
      if (event.type) types.push(event.type);
    }
  }
  return types;
}

/**
 * Validate that a state machine's emit and subscription event types exist in
 * the AsyncAPI channel index.
 *
 * - Emit types are validated against the spec declared in eventsSpec.
 * - Subscription types are validated against all known channels (cross-domain).
 *
 * Returns an array of error message strings.
 */
export function validateStateMachineEvents(doc, channelIndex) {
  const { byFile, all } = channelIndex;
  if (all.size === 0) return [];

  const errors = [];
  const eventsSpec = doc?.eventsSpec;

  // Validate emit types against the declared eventsSpec
  const ownChannels = eventsSpec ? (byFile.get(eventsSpec) ?? null) : null;
  for (const { type, path } of collectEmitSteps(doc)) {
    if (ownChannels === null) {
      // eventsSpec not declared or not found — validate against all channels
      if (!all.has(type)) {
        errors.push(`emit type "${type}" at ${path} not found in any AsyncAPI spec`);
      }
    } else if (!ownChannels.has(type)) {
      errors.push(`emit type "${type}" at ${path} not found in ${eventsSpec}`);
    }
  }

  // Build set of internal timer event types to skip — these are fired by the
  // workflow engine's timer scheduler, not published as external AsyncAPI events.
  // Timer events follow {domain}.{timerId} where domain is the eventsSpec prefix.
  const timerTypes = new Set();
  if (eventsSpec) {
    const domain = eventsSpec.replace(/-asyncapi\.yaml$/, '');
    for (const machine of doc?.machines || []) {
      for (const timer of machine.timers || []) {
        if (timer.id) timerTypes.add(`${domain}.${timer.id}`);
      }
    }
  }

  // Validate subscription types against all known channels
  for (const type of collectSubscriptionTypes(doc)) {
    if (timerTypes.has(type)) continue;
    if (!all.has(type)) {
      errors.push(`subscription type "${type}" not found in any AsyncAPI spec`);
    }
  }

  return errors;
}

/**
 * Build a cross-domain schema index from all OpenAPI specs.
 * Returns Map<domain, Set<schemaName>>, keyed by the spec's info.x-domain value.
 */
export function buildCrossDomainSchemaIndex(specsDir) {
  const index = new Map();

  for (const filePath of walkForPattern(specsDir, '-openapi.yaml')) {
    let spec;
    try { spec = yaml.load(readFileSync(filePath, 'utf8'), { schema: yaml.CORE_SCHEMA }); } catch { continue; }

    const domain = spec?.info?.['x-domain'];
    if (!domain) continue;

    if (!index.has(domain)) index.set(domain, new Set());
    for (const schemaName of Object.keys(spec?.components?.schemas || {})) {
      index.get(domain).add(schemaName);
    }
  }

  return index;
}

/**
 * Walk all properties in a schema, recursing into allOf branches.
 * Yields { schemaName, propName, rel } for each x-relationship with a domain qualifier.
 */
function* walkRelationships(schemaName, schema) {
  for (const branch of schema.allOf || []) yield* walkRelationships(schemaName, branch);
  for (const [propName, propSchema] of Object.entries(schema.properties || {})) {
    const rel = propSchema?.['x-relationship'];
    if (rel?.resource && rel?.domain) yield { schemaName, propName, rel };
  }
}

/**
 * Validate that cross-domain x-relationship targets exist in the referenced
 * domain's OpenAPI spec. Only checks references that declare domain: — local
 * and External/Polymorphic references are out of scope.
 *
 * Returns an array of error message strings.
 */
export function validateRelationshipTargets(spec, schemaIndex) {
  if (schemaIndex.size === 0) return [];

  const errors = [];
  const reservedResources = new Set(['External', 'Polymorphic']);

  for (const [schemaName, schema] of Object.entries(spec?.components?.schemas || {})) {
    for (const { propName, rel } of walkRelationships(schemaName, schema)) {
      if (reservedResources.has(rel.resource)) continue;
      if (rel.resource.includes('/')) continue; // path-style resource, skip

      const domainSchemas = schemaIndex.get(rel.domain);
      if (!domainSchemas) {
        errors.push(`${schemaName}.${propName}: x-relationship references unknown domain "${rel.domain}"`);
      } else if (!domainSchemas.has(rel.resource)) {
        errors.push(`${schemaName}.${propName}: x-relationship resource "${rel.resource}" not found in domain "${rel.domain}"`);
      }
    }
  }

  return errors;
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

  // Discover annotation files by $schema, not filename convention
  const annotationFiles = [];
  for (const filePath of walkForPattern(specDir, '.yaml')) {
    const file = basename(filePath);
    try {
      const doc = yaml.load(readFileSync(filePath, 'utf8'), { schema: yaml.CORE_SCHEMA });
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
      doc = preloaded ?? yaml.load(readFileSync(filePath, 'utf8'), { schema: yaml.CORE_SCHEMA });
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

  // ── AsyncAPI event type validation ────────────────────────────────────────

  console.log('='.repeat(70));
  console.log('AsyncAPI Event Type Validator');
  console.log('='.repeat(70));
  console.log(`  Directory: ${specDir}\n`);

  const channelIndex = buildAsyncApiChannelIndex(specDir);
  const files = walkForPattern(specDir, '.yaml').map(f => relative(specDir, f));
  const stateMachineFiles = files.filter(f => f.endsWith('-state-machine.yaml'));

  for (const file of stateMachineFiles) {
    const filePath = join(specDir, file);
    let doc;
    try { doc = yaml.load(readFileSync(filePath, 'utf8'), { schema: yaml.CORE_SCHEMA }); } catch { continue; }

    const eventErrors = validateStateMachineEvents(doc, channelIndex);
    if (eventErrors.length === 0) {
      console.log(`  ✓ ${file}`);
    } else {
      console.error(`  ✗ ${file}`);
      for (const msg of eventErrors) {
        console.error(`      ${msg}`);
      }
      totalErrors += eventErrors.length;
    }
  }

  console.log('');

  // ── Cross-domain x-relationship target validation ──────────────────────────

  console.log('='.repeat(70));
  console.log('Cross-Domain Relationship Target Validator');
  console.log('='.repeat(70));
  console.log(`  Directory: ${specDir}\n`);

  const schemaIndex = buildCrossDomainSchemaIndex(specDir);
  const openApiFiles = files.filter(f => f.endsWith('-openapi.yaml'));

  for (const file of openApiFiles) {
    const filePath = join(specDir, file);
    let spec;
    try { spec = yaml.load(readFileSync(filePath, 'utf8'), { schema: yaml.CORE_SCHEMA }); } catch { continue; }

    const relErrors = validateRelationshipTargets(spec, schemaIndex);
    if (relErrors.length === 0) {
      console.log(`  ✓ ${file}`);
    } else {
      console.error(`  ✗ ${file}`);
      for (const msg of relErrors) {
        console.error(`      ${msg}`);
      }
      totalErrors += relErrors.length;
    }
  }

  console.log('');

  if (totalErrors > 0) {
    console.error(`Annotation validation failed with ${totalErrors} error(s).`);
    process.exit(1);
  }

  console.log('Annotation validation passed.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
