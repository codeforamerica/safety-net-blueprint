#!/usr/bin/env node
/**
 * Reconcile example data against resolved OpenAPI schemas.
 *
 * After a state applies an overlay (adding fields, changing enums, etc.),
 * the examples file may be stale. This script:
 *   - Keeps existing valid properties unchanged
 *   - Removes properties that no longer exist in the schema
 *   - Adds missing required properties with generated values
 *   - Flags values it couldn't confidently fill
 *
 * Usage:
 *   node scripts/reconcile-examples.js --spec=<dir> [--out=<dir>] [--dry-run]
 *
 * Flags:
 *   --spec=<dir>   Directory containing OpenAPI specs (required)
 *   --out=<dir>    Output directory for reconciled examples (default: writes in place)
 *   --dry-run      Report changes without writing files
 *   -h, --help     Show this help message
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { realpathSync } from 'fs';
import yaml from 'js-yaml';
import $RefParser from '@apidevtools/json-schema-ref-parser';
import { discoverApiSpecs, getExamplesPath } from '../src/validation/openapi-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// =============================================================================
// Argument Parsing
// =============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    spec: null,
    out: null,
    dryRun: false,
    help: false
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg.startsWith('--spec=')) {
      options.spec = arg.split('=')[1];
    } else if (arg.startsWith('--out=')) {
      options.out = arg.split('=')[1];
    } else {
      console.error(`Error: Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  return options;
}

function showHelp() {
  console.log(`
Reconcile Examples Against Schemas

Ensures example data matches the current OpenAPI schema after overlays.
Keeps existing valid data, fills missing required fields, prunes removed fields.

Usage:
  node scripts/reconcile-examples.js --spec=<dir> [--out=<dir>] [--dry-run]

Flags:
  --spec=<dir>   Directory containing OpenAPI specs (required)
  --out=<dir>    Output directory for reconciled examples (default: writes in place)
  --dry-run      Report changes without writing files
  -h, --help     Show this help message

Examples:
  node scripts/reconcile-examples.js --spec=packages/contracts --dry-run
  node scripts/reconcile-examples.js --spec=packages/resolved --out=/tmp/reconciled
`);
}

// =============================================================================
// Schema Resolution
// =============================================================================

/**
 * Flatten allOf into a single merged object with properties, required, and type.
 * Handles the codebase pattern: allOf: [{...base}, { type: object, properties: ... }]
 * Operates on dereferenced specs where all $ref pointers are already inlined.
 */
export function resolveSchema(schema) {
  if (!schema) return { type: 'object', properties: {}, required: [] };

  if (schema.allOf) {
    let merged = { type: 'object', properties: {}, required: [] };
    for (const part of schema.allOf) {
      const resolved = resolveSchema(part);
      merged.properties = { ...merged.properties, ...resolved.properties };
      merged.required = [...merged.required, ...(resolved.required || [])];
      if (resolved.type) merged.type = resolved.type;
    }
    // Deduplicate required
    merged.required = [...new Set(merged.required)];
    return merged;
  }

  return {
    type: schema.type || 'object',
    properties: schema.properties || {},
    required: schema.required || []
  };
}

// =============================================================================
// Value Generation
// =============================================================================

/**
 * Generate a value for a schema property.
 * Returns { value, confident } where confident: false means the value is a guess.
 */
export function generateValue(propName, propSchema) {
  if (!propSchema) return { value: 'TODO', confident: false };

  // 1. Inline example from the schema author
  if (propSchema.example !== undefined) {
    return { value: propSchema.example, confident: true };
  }

  // 2. Enum — pick first value
  if (propSchema.enum && propSchema.enum.length > 0) {
    return { value: propSchema.enum[0], confident: true };
  }

  // 3. Default value
  if (propSchema.default !== undefined) {
    return { value: propSchema.default, confident: true };
  }

  // 4. Type + format mapping
  const type = propSchema.type;
  const format = propSchema.format;

  if (type === 'string') {
    if (format === 'uuid') return { value: '00000000-0000-0000-0000-000000000000', confident: true };
    if (format === 'date-time') return { value: '2024-01-01T00:00:00Z', confident: true };
    if (format === 'date') return { value: '2024-01-01', confident: true };
    if (format === 'email') return { value: 'user@example.com', confident: true };
    if (format === 'uri') return { value: 'https://example.com', confident: true };

    // 5. Field name heuristics (no format specified)
    if (!format) {
      if (/email/i.test(propName)) return { value: 'user@example.com', confident: true };
      if (/phone/i.test(propName)) return { value: '+1-555-000-0000', confident: true };
      if (/Id$/.test(propName)) return { value: '00000000-0000-0000-0000-000000000000', confident: true };
      if (/name/i.test(propName)) return { value: 'Example Name', confident: true };
      if (propName === 'status') return { value: 'active', confident: false };
    }

    return { value: 'example', confident: false };
  }

  if (type === 'integer' || type === 'number') {
    return { value: 0, confident: true };
  }

  if (type === 'boolean') {
    return { value: false, confident: true };
  }

  if (type === 'array') {
    return { value: [], confident: true };
  }

  if (type === 'object' || propSchema.properties) {
    const { obj, warnings } = generateObject(propSchema);
    return { value: obj, confident: warnings.length === 0 };
  }

  // For schemas that are objects due to allOf or $ref but no explicit type
  if (propSchema.allOf) {
    const resolved = resolveSchema(propSchema);
    const { obj, warnings } = generateObject(resolved);
    return { value: obj, confident: warnings.length === 0 };
  }

  return { value: 'TODO', confident: false };
}

/**
 * Generate an object with required properties filled in.
 * Also includes optional properties that have an inline example annotation.
 * Returns { obj, warnings }.
 */
export function generateObject(schema) {
  const resolved = resolveSchema(schema);
  const obj = {};
  const warnings = [];

  for (const [propName, propSchema] of Object.entries(resolved.properties || {})) {
    const isRequired = resolved.required.includes(propName);
    const hasExample = propSchema.example !== undefined;

    if (!isRequired && !hasExample) continue;

    const { value, confident } = generateValue(propName, propSchema);
    obj[propName] = value;
    if (!confident) {
      warnings.push({ property: propName, reason: 'low-confidence generated value' });
    }
  }

  return { obj, warnings };
}

// =============================================================================
// Reconciliation
// =============================================================================

/**
 * Reconcile a single example object against a schema.
 * Returns { reconciled, added, pruned, flagged }.
 */
export function reconcileExample(example, schema) {
  const resolved = resolveSchema(schema);
  const properties = resolved.properties || {};
  const required = resolved.required || [];

  const reconciled = {};
  const added = [];
  const pruned = [];
  const flagged = [];

  // Walk existing example properties
  for (const [key, value] of Object.entries(example)) {
    if (!(key in properties)) {
      // Property no longer in schema — prune
      pruned.push(key);
      continue;
    }

    const propSchema = properties[key];
    const propResolved = resolveSchema(propSchema);

    // If it's a nested object with sub-properties, recurse
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(propResolved.properties || {}).length > 0
    ) {
      const nested = reconcileExample(value, propSchema);
      reconciled[key] = nested.reconciled;
      added.push(...nested.added.map(a => ({ ...a, property: `${key}.${a.property}` })));
      pruned.push(...nested.pruned.map(p => `${key}.${p}`));
      flagged.push(...nested.flagged.map(f => ({ ...f, property: `${key}.${f.property}` })));
    } else if (propSchema.enum && !propSchema.enum.includes(value)) {
      // Existing value is no longer in the enum — replace
      const { value: newValue, confident } = generateValue(key, propSchema);
      reconciled[key] = newValue;
      added.push({ property: key, value: formatValueForReport(newValue), was: formatValueForReport(value) });
      if (!confident) {
        flagged.push({ property: key, reason: 'could not determine value' });
      }
    } else {
      // Keep existing value as-is
      reconciled[key] = value;
    }
  }

  // Add missing required properties
  for (const propName of required) {
    if (propName in reconciled) continue;
    // Also skip if it was in the original example (already processed above)
    if (propName in example) continue;

    const propSchema = properties[propName];
    if (!propSchema) {
      // Required field listed but no schema definition — flag it
      flagged.push({ property: propName, reason: 'required but not defined in schema properties' });
      continue;
    }

    const { value, confident } = generateValue(propName, propSchema);
    reconciled[propName] = value;
    added.push({ property: propName, value: formatValueForReport(value) });

    if (!confident) {
      flagged.push({ property: propName, reason: 'could not determine value' });
    }
  }

  return { reconciled, added, pruned, flagged };
}

/**
 * Format a value for console reporting.
 */
function formatValueForReport(value) {
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// =============================================================================
// Spec + Examples Orchestration
// =============================================================================

/**
 * Find the main resource schema in a dereferenced spec.
 * The main schema is the PascalCase name that isn't *Create, *Update, or *List.
 */
function findMainResourceSchema(spec) {
  const schemas = spec.components?.schemas;
  if (!schemas) return null;

  const schemaNames = Object.keys(schemas);

  // Filter to schemas that look like main resources
  const candidates = schemaNames.filter(name => {
    if (name.endsWith('Create') || name.endsWith('Update') || name.endsWith('List')) return false;
    // Must start with uppercase (PascalCase)
    if (name[0] !== name[0].toUpperCase()) return false;
    return true;
  });

  // Among candidates, find one whose name + "List" also exists (the main resource)
  for (const name of candidates) {
    if (schemaNames.includes(`${name}List`)) {
      return { name, schema: schemas[name] };
    }
  }

  // Fallback: first candidate
  if (candidates.length > 0) {
    return { name: candidates[0], schema: schemas[candidates[0]] };
  }

  return null;
}

/**
 * Determine whether an example key represents a seedable resource.
 * Same filtering logic as the mock server seeder.
 */
function isSeedableExample(key, value) {
  if (!value || typeof value !== 'object') return false;
  if (value.items && Array.isArray(value.items)) return false;
  const lowerKey = key.toLowerCase();
  if (lowerKey.includes('payload') || lowerKey.includes('create') || lowerKey.includes('update')) return false;
  if (!value.id) return false;
  return true;
}

/**
 * Reconcile examples for a single API spec.
 * Returns { examplesPath, reconciled, report } or null if no examples.
 */
async function reconcileSpecExamples(specPath, examplesPath) {
  if (!existsSync(examplesPath)) return null;

  // Load and dereference spec
  const spec = await $RefParser.dereference(specPath, {
    dereference: { circular: 'ignore' }
  });

  // Find main resource schema
  const mainSchema = findMainResourceSchema(spec);
  if (!mainSchema) return null;

  // Load existing examples
  const examplesContent = readFileSync(examplesPath, 'utf8');
  const examples = yaml.load(examplesContent) || {};

  const reconciledExamples = {};
  const report = { examples: [], totalAdded: 0, totalPruned: 0, totalFlagged: 0 };

  for (const [key, value] of Object.entries(examples)) {
    if (!isSeedableExample(key, value)) {
      // Keep non-seedable examples as-is
      reconciledExamples[key] = value;
      continue;
    }

    const { reconciled, added, pruned, flagged } = reconcileExample(value, mainSchema.schema);
    reconciledExamples[key] = reconciled;

    report.examples.push({ key, added, pruned, flagged });
    report.totalAdded += added.length;
    report.totalPruned += pruned.length;
    report.totalFlagged += flagged.length;
  }

  return { examplesPath, reconciled: reconciledExamples, report };
}

// =============================================================================
// Console Reporting
// =============================================================================

function printReport(apiName, report) {
  const examplesWithChanges = report.examples.filter(
    e => e.added.length > 0 || e.pruned.length > 0 || e.flagged.length > 0
  );

  if (examplesWithChanges.length === 0) {
    console.log(`  No changes needed`);
    return;
  }

  for (const ex of examplesWithChanges) {
    console.log(`  ${ex.key}:`);
    for (const a of ex.added) {
      const flag = ex.flagged.some(f => f.property === a.property)
        ? ` (flagged -- could not determine value)`
        : '';
      const wasNote = a.was ? ` (was ${a.was})` : '';
      console.log(`    + ${a.property}: ${a.value}${wasNote}${flag}`);
    }
    for (const p of ex.pruned) {
      console.log(`    - ${p}: removed`);
    }
    // Show flags that aren't already shown with an added entry
    for (const f of ex.flagged) {
      const alreadyShown = ex.added.some(a => a.property === f.property);
      if (!alreadyShown) {
        console.log(`    ! ${f.property}: ${f.reason}`);
      }
    }
  }

  const reconciledCount = report.examples.length;
  console.log(`  ${reconciledCount} examples reconciled, ${report.totalAdded} fields added, ${report.totalPruned} pruned, ${report.totalFlagged} flagged`);
}

// =============================================================================
// Main
// =============================================================================

export async function reconcileAllExamples({ specsDir, outDir, dryRun = false } = {}) {
  const apiSpecs = discoverApiSpecs({ specsDir });
  let totalAdded = 0;
  let totalPruned = 0;
  let totalFlagged = 0;
  let apisProcessed = 0;

  for (const api of apiSpecs) {
    const examplesPath = getExamplesPath(api.name, specsDir);
    console.log(`Reconciling ${api.name} examples...`);

    const result = await reconcileSpecExamples(api.specPath, examplesPath);

    if (!result) {
      console.log(`  Skipped (no examples or no main resource schema)`);
      continue;
    }

    printReport(api.name, result.report);
    totalAdded += result.report.totalAdded;
    totalPruned += result.report.totalPruned;
    totalFlagged += result.report.totalFlagged;
    apisProcessed++;

    if (!dryRun) {
      const targetPath = outDir
        ? join(outDir, `${api.name}-openapi-examples.yaml`)
        : result.examplesPath;

      const output = yaml.dump(result.reconciled, {
        lineWidth: -1,
        noRefs: true,
        quotingType: '"',
        forceQuotes: false
      });
      writeFileSync(targetPath, output);
    }
  }

  console.log('');
  if (dryRun) {
    console.log(`Dry run complete: ${apisProcessed} APIs checked, ${totalAdded} fields to add, ${totalPruned} to prune, ${totalFlagged} flagged`);
  } else {
    console.log(`Reconciliation complete: ${apisProcessed} APIs processed, ${totalAdded} fields added, ${totalPruned} pruned, ${totalFlagged} flagged`);
  }

  return { totalAdded, totalPruned, totalFlagged, apisProcessed };
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  if (!options.spec) {
    console.error('Error: --spec=<dir> is required');
    process.exit(1);
  }

  const specsDir = resolve(options.spec);
  const outDir = options.out ? resolve(options.out) : null;

  if (!existsSync(specsDir)) {
    console.error(`Error: Spec directory does not exist: ${specsDir}`);
    process.exit(1);
  }

  await reconcileAllExamples({ specsDir, outDir, dryRun: options.dryRun });
}

// Run main when executed directly
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(resolve(process.argv[1]));
if (isDirectRun) {
  main();
}
