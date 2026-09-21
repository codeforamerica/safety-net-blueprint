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

import { readFileSync } from 'fs';
import { resolve, relative, isAbsolute, basename } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import yaml from 'js-yaml';
import { resolveRef, resolveSchemaRefs, collectTopLevelProperties, getPropertyAtPath } from '@codeforamerica/blueprint-core/json-schema';
import { loadContractFiles } from '@codeforamerica/blueprint-core/openapi';



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
 * Build a map of domain → loaded OpenAPI spec from all OpenAPI specs in a directory.
 * Returns: Map<domain, { spec, filePath }>
 */
export function buildDomainSpecMap(specsDir) {
  const map = new Map();

  for (const [filePath, { content: spec, type }] of loadContractFiles(specsDir)) {
    if (type !== 'openapi') continue;
    const domain = spec?.info?.['x-domain'];
    if (domain && !map.has(domain)) map.set(domain, { spec, filePath });
  }

  return map;
}

/**
 * Build a map of camelCase sub-resource segment → resolved schema for a given spec.
 * Scans API paths for sub-resource endpoints (paths with a parent param segment)
 * and registers the GET response schema under the camelCase path segment name.
 *
 * Used as a fallback in validateAnnotationPath for annotation keys like
 * "application.householdInfo.utilitiesIncludedInRent" where "householdInfo"
 * is a sub-resource (served at /applications/{id}/household-info) rather than
 * a direct property of the Application schema.
 *
 * @param {object} spec
 * @param {string} specFilePath
 * @returns {Map<string, object>} camelCaseSegment → resolvedSchema
 */
function buildSubResourceSchemaMap(spec, specFilePath) {
  const map = new Map();
  const schemas = spec?.components?.schemas ?? {};

  function getSchemaForRef(ref) {
    const name = typeof ref === 'string' ? ref.match(/^#\/components\/schemas\/(.+)$/)?.[1] : null;
    const raw = name ? schemas[name] : null;
    return raw ? resolveSchemaRefs(raw, { spec, specFilePath }) : null;
  }

  for (const [path, pathItem] of Object.entries(spec?.paths ?? {})) {
    const segments = path.split('/').filter(Boolean);
    const lastSeg = segments[segments.length - 1];
    const hasParentParam = segments.slice(0, -1).some(s => s.startsWith('{'));
    if (!hasParentParam) continue; // skip top-level paths

    if (lastSeg.startsWith('{')) {
      // Detail endpoint (e.g. /applications/{id}/tax-filers/{taxFilerId}).
      // Register the item schema under both plural camelCase ("taxFilers") and
      // singular ("taxFiler") keys. Item schema takes priority over collection list schema.
      const collectionSeg = segments[segments.length - 2];
      if (!collectionSeg || collectionSeg.startsWith('{')) continue;
      const camelKey = collectionSeg.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const singularKey = camelKey.replace(/s$/, ''); // naive singularization
      const schema = getSchemaForRef(pathItem.get?.responses?.['200']?.content?.['application/json']?.schema?.$ref);
      if (schema) {
        map.set(camelKey, schema); // overwrite list schema if present
        if (singularKey !== camelKey && !map.has(singularKey)) map.set(singularKey, schema);
      }
    } else {
      // Singleton sub-resource or collection without a detail companion.
      // Only register if not already mapped (item schema from detail endpoint takes priority).
      const camelKey = lastSeg.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (map.has(camelKey)) continue;
      const schema = getSchemaForRef(pathItem.get?.responses?.['200']?.content?.['application/json']?.schema?.$ref);
      if (schema) map.set(camelKey, schema);
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

  for (const { content, type } of loadContractFiles(specsDir).values()) {
    if (type !== 'state-machine') continue;
    for (const machine of content?.machines || []) {
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

  for (const { content, type } of loadContractFiles(specsDir).values()) {
    if (type !== 'policies') continue;
    for (const policyId of Object.keys(content?.policies || {})) {
      index.add(policyId);
    }
  }

  return index;
}

const ANNOTATION_METADATA_FIELDS = new Set(['$schema', 'version', 'domain']);

/**
 * Build an index of valid entry IDs from all generic registry files.
 * Discovers files whose $schema ends with registry-schema.yaml.
 * Returns: Map<registryType, Set<entryId>>
 */
export function buildRegistryIndex(specsDir) {
  const index = new Map();

  for (const { content, type } of loadContractFiles(specsDir).values()) {
    if (type !== 'registry') continue;
    const registryType = content.type;
    if (!registryType) continue;
    if (!index.has(registryType)) index.set(registryType, new Set());
    for (const entryId of Object.keys(content?.entries || {})) {
      index.get(registryType).add(entryId);
    }
  }

  return index;
}

/**
 * Validate all registry citations in an annotation document against the registry index.
 * For each annotation entry, any property whose name matches a known registry type is
 * treated as an array of entry IDs and validated against that type's index.
 *
 * Returns an array of error message strings (empty if all citations are valid).
 */
export function validateAnnotationRegistryCitations(annotationDoc, registryIndex) {
  if (registryIndex.size === 0) return [];

  const errors = [];

  for (const [sectionName, section] of Object.entries(annotationDoc || {})) {
    if (ANNOTATION_METADATA_FIELDS.has(sectionName)) continue;
    if (typeof section !== 'object' || Array.isArray(section)) continue;
    for (const [key, entry] of Object.entries(section)) {
      for (const [registryType, entryIndex] of registryIndex) {
        for (const entryId of entry?.[registryType] || []) {
          if (!entryIndex.has(entryId)) {
            errors.push(`${registryType} entry "${entryId}" cited at ${sectionName}["${key}"] not found in ${registryType} registry`);
          }
        }
      }
    }
  }

  return errors;
}

/**
 * Validate all policy citations in an annotation document against the policy index.
 * Checks all annotation sections generically — any section key with a policies: array
 * is validated, regardless of which section it is in.
 *
 * Returns an array of error message strings (empty if all citations are valid).
 */
export function validateAnnotationPolicyCitations(annotationDoc, policyIndex) {
  if (policyIndex.size === 0) return []; // no policies loaded — skip

  const errors = [];

  for (const [sectionName, section] of Object.entries(annotationDoc || {})) {
    if (ANNOTATION_METADATA_FIELDS.has(sectionName)) continue;
    if (typeof section !== 'object' || Array.isArray(section)) continue;
    for (const [key, entry] of Object.entries(section)) {
      for (const policyId of entry?.policies || []) {
        if (!policyIndex.has(policyId)) {
          errors.push(`Policy "${policyId}" cited at ${sectionName}["${key}"] not found in policy registry`);
        }
      }
    }
  }

  return errors;
}

/**
 * Validate a single annotation schema key against the domain spec map.
 *
 * Path format: spec-relative dot-bracket notation.
 *   - First segment is the camelCase schema name (e.g. "application" → Application)
 *   - Remaining segments are the field path (e.g. "members[].dateOfBirth")
 *   - [] denotes array item traversal
 *
 * Annotation keys are always written in camelCase (the canonical YAML property
 * naming convention), regardless of any x-casing configuration in the overlay.
 * x-casing is a rendering hint for the API surface, not a rename of YAML properties.
 *
 * @param {string} pathKey - e.g. "application.members[].dateOfBirth"
 * @param {Map<string, { spec, filePath }>} domainSpecMap
 * @param {string|null} annotationDomain - domain declared in the annotation file
 * @returns {string|null} error message, or null on success
 */
export function validateAnnotationPath(pathKey, domainSpecMap, annotationDomain) {
  if (!pathKey) return `Empty path key`;

  const dotIndex = pathKey.indexOf('.');
  const prefix = dotIndex === -1 ? pathKey : pathKey.slice(0, dotIndex);
  const fieldPath = dotIndex === -1 ? null : pathKey.slice(dotIndex + 1);

  const baseName = prefix.charAt(0).toUpperCase() + prefix.slice(1);
  // Annotation keys use the base schema name without Request/Response suffixes.
  // Try exact match first, then common generated suffixes.
  const candidateNames = [baseName, `${baseName}Response`, `${baseName}Request`];

  // Find the spec and the resolved schema name: prefer the annotation's declared
  // domain, fall back to any domain that contains one of the candidate names.
  let specEntry = null;
  let schemaName = null;

  const tryDomain = (entry) => {
    for (const name of candidateNames) {
      if (entry.spec?.components?.schemas?.[name]) return name;
    }
    return null;
  };

  if (annotationDomain) {
    const domainEntry = domainSpecMap.get(annotationDomain);
    if (domainEntry) {
      const found = tryDomain(domainEntry);
      if (found) { specEntry = domainEntry; schemaName = found; }
    }
  }

  if (!specEntry) {
    for (const entry of domainSpecMap.values()) {
      const found = tryDomain(entry);
      if (found) { specEntry = entry; schemaName = found; break; }
    }
  }

  if (!specEntry) {
    return domainSpecMap.size > 0
      ? `Schema "${baseName}" not found in any OpenAPI spec`
      : null;
  }

  const { spec, filePath: specFilePath } = specEntry;
  const rawSchema = spec.components?.schemas?.[schemaName];
  if (!rawSchema) {
    return `Schema "${baseName}" not found in spec`;
  }

  if (!fieldPath) return null; // Annotating the top-level schema — OK

  // Resolve external $refs (e.g. ../intake-schema.yaml#/$defs/Application) before
  // navigating — the generated contracts may still reference intra-domain schema files.
  const schema = resolveSchemaRefs(rawSchema, { spec, specFilePath });

  // Try direct path navigation first.
  if (getPropertyAtPath(spec, schema, fieldPath)) return null;

  // Fall back to segment-by-segment walk with sub-resource lookup. This handles
  // annotation keys like "application.householdInfo.utilitiesIncludedInRent" where
  // "householdInfo" is a sub-resource (at /applications/{id}/household-info) rather
  // than a direct property of Application.
  const subResourceMap = buildSubResourceSchemaMap(spec, specFilePath);
  const segments = fieldPath.replace(/\[\]/g, '').split('.').filter(Boolean);
  let current = schema;
  for (const seg of segments) {
    const props = collectTopLevelProperties(spec, current);
    if (props.has(seg)) {
      current = props.get(seg);
      continue;
    }
    // Try inside array items (for paths that already navigated into an array)
    if (current.items) {
      const items = current.items.$ref ? (resolveRef(spec, current.items.$ref) ?? current.items) : current.items;
      const itemProps = collectTopLevelProperties(spec, items);
      if (itemProps.has(seg)) { current = itemProps.get(seg); continue; }
    }
    // Try as a sub-resource segment
    if (subResourceMap.has(seg)) { current = subResourceMap.get(seg); continue; }

    return `Path "${pathKey}" does not exist in schema`;
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

  for (const [filePath, { content: doc, type }] of loadContractFiles(specsDir)) {
    if (type !== 'asyncapi') continue;
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

  // Build set of timer IDs declared in this state machine. Timer callback events
  // are fired by the workflow engine's scheduler and are NOT published as AsyncAPI
  // channels. After overlay resolution the event type prefix (e.g. "ca.") is baked
  // into the subscription type, so we match by ID suffix rather than exact prefix.
  const timerIds = new Set();
  for (const machine of doc?.machines || []) {
    for (const timer of machine.timers || []) {
      if (timer.id) timerIds.add(timer.id);
    }
  }

  // Validate subscription types against all known channels, skipping timer callbacks.
  for (const type of collectSubscriptionTypes(doc)) {
    const isTimerCallback = [...timerIds].some(id => type === id || type.endsWith(`.${id}`));
    if (isTimerCallback) continue;
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

  for (const { content: spec, type } of loadContractFiles(specsDir).values()) {
    if (type !== 'openapi') continue;
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

/**
 * Validate a single annotation event key against the AsyncAPI channel index.
 * Key format: the event type identifier (e.g. "intake.application.submitted").
 * Returns null on success, or an error message string on failure.
 */
export function validateAnnotationEvent(eventKey, allChannels) {
  if (allChannels.size === 0) return null; // no AsyncAPI specs loaded — skip
  if (!allChannels.has(eventKey)) {
    return `Event "${eventKey}" not found in any AsyncAPI spec`;
  }
  return null;
}

/**
 * Build an index of known fact names from all compiled graph files.
 * Uses detectType to discover graph files by $schema rather than filename.
 * Returns: Map<rulesetName, Set<factName>>
 */
export function buildGraphIndex(specsDir) {
  const index = new Map(); // Map<ruleset, { domain, facts: Set<factName> }>

  for (const { content: doc, type, domain } of loadContractFiles(specsDir).values()) {
    if (type !== 'graph') continue;
    const ruleset = doc.ruleset;
    if (!ruleset) continue;
    index.set(ruleset, { domain, facts: new Set(Object.keys(doc.facts || {})) });
  }

  return index;
}

/**
 * Validate a single annotation fact key against the graph index.
 * Key format: "{ruleset}.{factName}" (e.g. "snapInterviewProbes.incomeInconsistency").
 * Returns null on success, or an error message string on failure.
 */
export function validateFactKey(key, graphIndex, annotationDomain) {
  if (graphIndex.size === 0) return null; // no graphs loaded — skip

  const dot = key.indexOf('.');
  if (dot === -1) return `Fact key "${key}" must be in {ruleset}.{factName} format`;

  const ruleset = key.slice(0, dot);
  const factName = key.slice(dot + 1);

  const entry = graphIndex.get(ruleset);
  if (!entry) return `Ruleset "${ruleset}" not found in any compiled graph`;
  if (annotationDomain && entry.domain !== annotationDomain) {
    return `Ruleset "${ruleset}" belongs to domain "${entry.domain}" but is annotated in domain "${annotationDomain}"`;
  }
  if (!entry.facts.has(factName)) return `Fact "${factName}" not found in ruleset "${ruleset}"`;

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

  const contractFiles = loadContractFiles(specDir);

  // Discover annotation files by $schema, not filename convention
  const annotationFiles = [];
  for (const [filePath, { content: doc, type }] of contractFiles) {
    if (type === 'annotations') {
      const file = basename(filePath);
      annotationFiles.push({ file, filePath, doc });
    }
  }
  if (annotationFiles.length === 0) {
    console.log('  No annotation files found. Nothing to validate.\n');
    process.exit(0);
  }

  console.log(`  Found ${annotationFiles.length} annotation file(s)\n`);

  const domainSpecMap = buildDomainSpecMap(specDir);
  const actionIndex = buildStateMachineActionIndex(specDir);
  const channelIndex = buildAsyncApiChannelIndex(specDir);
  const graphIndex = buildGraphIndex(specDir);
  const registryIndex = buildRegistryIndex(specDir);
  const policyIndex = buildPolicyIndex(specDir);

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

    const fileErrors = [];
    let totalKeys = 0;

    const annotationDomain = doc.domain;
    const sectionValidators = {
      schema:     key => validateAnnotationPath(key, domainSpecMap, annotationDomain),
      operations: key => validateAnnotationOperation(key, actionIndex),
      events:     key => validateAnnotationEvent(key, channelIndex.all),
      facts:      key => validateFactKey(key, graphIndex, annotationDomain),
    };

    for (const [sectionName, sectionData] of Object.entries(doc || {})) {
      if (ANNOTATION_METADATA_FIELDS.has(sectionName)) continue;
      if (typeof sectionData !== 'object' || Array.isArray(sectionData)) continue;

      const validateKey = sectionValidators[sectionName];
      if (!validateKey) continue; // unknown section — caught by schema validation

      for (const key of Object.keys(sectionData)) {
        totalKeys++;
        const err = validateKey(key);
        if (err) fileErrors.push({ section: sectionName, key, message: err });
      }
    }

    for (const msg of validateAnnotationRegistryCitations(doc, registryIndex)) {
      fileErrors.push({ section: null, key: null, message: msg });
    }

    for (const msg of validateAnnotationPolicyCitations(doc, policyIndex)) {
      fileErrors.push({ section: null, key: null, message: msg });
    }

    if (fileErrors.length === 0) {
      console.log(`  ✓ ${file} (${totalKeys} keys)`);
    } else {
      console.error(`  ✗ ${file}`);
      for (const { section, key, message } of fileErrors) {
        console.error(`      ${message}`);
        if (section != null) console.error(`        at: ${section}["${key}"]`);
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

  for (const [filePath, { content: doc, type, relativePath: file }] of contractFiles) {
    if (type !== 'state-machine') continue;

    const eventErrors = [
      ...validateStateMachineEvents(doc, channelIndex),
    ];
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

  for (const [filePath, { content: spec, type, relativePath: file }] of contractFiles) {
    if (type !== 'openapi') continue;

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
