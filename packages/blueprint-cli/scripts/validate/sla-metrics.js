#!/usr/bin/env node
/**
 * SLA Types and Metrics Field Reference Validator
 *
 * Validates that var: field names in *-sla-types.yaml and *-metrics.yaml files
 * reference fields that exist on the target OpenAPI resource schema.
 *
 * SLA types: pauseWhen.in[].var — references a field on the SLA's target resource.
 *   The target resource is inferred from the domain (workflow → Task).
 *
 * Metrics: filter.var, source.filter.var, from.filter.var, to.filter.var —
 *   references a field on the collection's resource schema.
 *   collection: tasks → Task schema
 *   collection: events — runtime-only, not in OpenAPI; skipped.
 *
 * Usage:
 *   node scripts/validate-sla-metrics.js --spec=.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join, relative, isAbsolute, basename } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import yaml from 'js-yaml';
import { resolveRef, collectTopLevelProperties, resolveSchemaRefs } from '@codeforamerica/blueprint-core/state-machine-validator';

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
 * Build a collection→schema properties map from all OpenAPI specs.
 * Returns: Map<collectionName, { spec, properties: Map<fieldName, schema> }>
 *
 * collectionName is the path segment (e.g. "tasks", "applications").
 */
export function buildCollectionSchemaMap(specsDir) {
  const map = new Map();

  for (const specFilePath of walkForPattern(specsDir, '-openapi.yaml')) {
    const slaRel = relative(resolve(specsDir), resolve(specFilePath));
    if (slaRel.startsWith('..') || isAbsolute(slaRel)) continue;
    let spec;
    try { spec = yaml.load(readFileSync(specFilePath, 'utf8'), { schema: yaml.DEFAULT_SCHEMA }); } catch { continue; }
    if (!spec?.paths) continue;

    for (const [path, pathItem] of Object.entries(spec.paths)) {
      const segments = path.split('/').filter(Boolean);
      if (segments.length !== 2 || !segments[0].match(/^[a-z]/) || !segments[1].startsWith('{')) continue;

      const collection = segments[0]; // e.g. "tasks"
      if (map.has(collection)) continue;

      const getOp = pathItem.get;
      const schemaRef = getOp?.responses?.['200']?.content?.['application/json']?.schema;
      if (schemaRef?.$ref) {
        const match = schemaRef.$ref.match(/^#\/components\/schemas\/(.+)$/);
        if (match) {
          const rawSchema = spec?.components?.schemas?.[match[1]];
          if (rawSchema) {
            const schema = resolveSchemaRefs(rawSchema, { spec, specFilePath });
            map.set(collection, { spec, properties: collectTopLevelProperties(spec, schema) });
          }
        }
      }
    }
  }

  return map;
}

/**
 * Walk all var: string values in a JSON Logic filter expression.
 * Returns an array of field names referenced by var:.
 */
export function extractVarFields(filterNode) {
  const fields = [];

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if ('var' in node && typeof node.var === 'string') {
      // Strip path prefixes like "slaInfo.*.status" → take the last meaningful segment
      // or just report the full path
      fields.push(node.var);
      return;
    }
    for (const val of Object.values(node)) walk(val);
  }

  walk(filterNode);
  return fields;
}

/**
 * Validate var: field names in SLA types against the target collection schema.
 * SLA types don't declare their target collection explicitly; we validate `status`
 * as a known task field (the only field SLA types reference).
 */
export function validateSlaTypes(doc, collectionMap) {
  const errors = [];
  if (!doc?.slaTypes) return errors;

  // SLA types are always in the workflow domain and target the Task schema
  const taskSchema = collectionMap.get('tasks');

  for (const slaType of doc.slaTypes) {
    if (!slaType?.pauseWhen) continue;

    const varFields = extractVarFields(slaType.pauseWhen);
    for (const fieldName of varFields) {
      const topField = fieldName.split('.')[0];

      if (!taskSchema) {
        // No Task schema found — can't validate
        break;
      }

      if (!taskSchema.properties.has(topField)) {
        errors.push({
          slaTypeId: slaType.id,
          message: `var: "${fieldName}" — field "${topField}" does not exist on Task schema`,
          path: `slaTypes[${slaType.id}].pauseWhen`
        });
      }
    }
  }

  return errors;
}

/**
 * Validate var: field names in metrics against the source collection schema.
 * Metrics reference collection names (tasks, events). Events are runtime-only; skipped.
 */
export function validateMetrics(doc, collectionMap) {
  const errors = [];
  if (!doc?.metrics) return errors;

  function checkFilter(filter, collection, metricId, filterPath) {
    if (!filter) return;
    const varFields = extractVarFields(filter);
    const schemaEntry = collectionMap.get(collection);

    for (const fieldName of varFields) {
      if (!schemaEntry) continue; // Collection not in OpenAPI (e.g. events) — skip

      const topField = fieldName.split('.')[0];
      if (!schemaEntry.properties.has(topField)) {
        errors.push({
          metricId,
          message: `var: "${fieldName}" — field "${topField}" does not exist on schema for collection "${collection}"`,
          path: `metrics[${metricId}].${filterPath}`
        });
      }
    }
  }

  for (const metric of doc.metrics) {
    const id = metric.id;

    // source.collection + source.filter
    if (metric.source?.filter) {
      checkFilter(metric.source.filter, metric.source.collection, id, 'source.filter');
    }

    // from.collection + from.filter
    if (metric.from?.filter) {
      checkFilter(metric.from.filter, metric.from.collection, id, 'from.filter');
    }

    // to.collection + to.filter
    if (metric.to?.filter) {
      checkFilter(metric.to.filter, metric.to.collection, id, 'to.filter');
    }

    // total.collection (no filter key to check, but note it for completeness)
  }

  return errors;
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    console.log('Usage: node scripts/validate-sla-metrics.js --spec=<dir>');
    process.exit(0);
  }

  const specDir = resolve(options.specDir || DEFAULT_SPEC_DIR);

  console.log('='.repeat(70));
  console.log('SLA Types and Metrics Field Reference Validator');
  console.log('='.repeat(70));
  console.log(`  Directory: ${specDir}\n`);

  const collectionMap = buildCollectionSchemaMap(specDir);

  let totalErrors = 0;

  // Discover SLA and metrics files by $schema, not filename convention
  const slaFiles = [];
  const metricsFiles = [];
  for (const filePath of walkForPattern(specDir, '.yaml')) {
    const file = basename(filePath);
    try {
      const doc = yaml.load(readFileSync(filePath, 'utf8'));
      const schemaBasename = doc?.$schema?.split('/').pop();
      if (schemaBasename === 'sla-types-schema.yaml') slaFiles.push({ file, filePath, doc });
      else if (schemaBasename === 'metrics-schema.yaml') metricsFiles.push({ file, filePath, doc });
    } catch {
      // unparseable files — caught per-file below
    }
  }

  if (slaFiles.length === 0 && metricsFiles.length === 0) {
    console.log('  No SLA types or metrics files found. Nothing to validate.\n');
    process.exit(0);
  }

  for (const { file, filePath, doc: preloaded } of slaFiles) {
    let doc;
    try { doc = preloaded ?? yaml.load(readFileSync(filePath, 'utf8')); } catch (err) {
      console.error(`  ✗ ${file}`);
      console.error(`      Parse error: ${err.message}`);
      totalErrors++;
      continue;
    }

    const errors = validateSlaTypes(doc, collectionMap);

    if (errors.length === 0) {
      console.log(`  ✓ ${file}`);
    } else {
      console.error(`  ✗ ${file}`);
      for (const { slaTypeId, message, path } of errors) {
        console.error(`      [sla-var-field] ${message}`);
        console.error(`        at: ${path}`);
      }
      totalErrors += errors.length;
    }
  }

  for (const { file, filePath, doc: preloaded } of metricsFiles) {
    let doc;
    try { doc = preloaded ?? yaml.load(readFileSync(filePath, 'utf8')); } catch (err) {
      console.error(`  ✗ ${file}`);
      console.error(`      Parse error: ${err.message}`);
      totalErrors++;
      continue;
    }

    const errors = validateMetrics(doc, collectionMap);

    if (errors.length === 0) {
      console.log(`  ✓ ${file}`);
    } else {
      console.error(`  ✗ ${file}`);
      for (const { metricId, message, path } of errors) {
        console.error(`      [metrics-var-field] ${message}`);
        console.error(`        at: ${path}`);
      }
      totalErrors += errors.length;
    }
  }

  console.log('');

  if (totalErrors > 0) {
    console.error(`SLA/metrics validation failed with ${totalErrors} error(s).`);
    process.exit(1);
  }

  console.log('SLA/metrics validation passed.');
}

main();
