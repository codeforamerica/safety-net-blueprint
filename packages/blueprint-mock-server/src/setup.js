/**
 * Shared setup functionality for mock server
 * Handles loading specs and seeding databases
 */

import { loadAllSpecs, discoverApiSpecs } from './spec-loader.js';
import { seedAllDatabases } from './seeder.js';
import { validateMockData } from './mock-data-validator.js';
import { validateAll, getValidationStatus } from './spec-validator.js';
import { discoverStateMachines } from './state-machine-loader.js';
import { discoverSlaTypes } from './sla-loader.js';
import { discoverMetrics } from './metrics-loader.js';
import { discoverConfigs } from './config-loader.js';
import { insertResource } from './database-manager.js';
import { registerConfigManaged } from './config-registry.js';
import { discover, generate, load } from '@codeforamerica/blueprint-core';
/**
 * Perform setup: load specs and seed databases
 * @param {Object} options - Setup options
 * @param {string} options.specsDir - Path to specs directory (required)
 * @param {boolean} options.verbose - Show detailed output
 * @param {boolean} options.skipValidation - Skip validation step
 * @returns {Promise<Object>} Setup result with apiSpecs and summary
 */
export async function performSetup({ specsDir, seedDir, verbose = true, skipValidation = false } = {}) {
  if (!specsDir) {
    throw new Error('specsDir is required — pass --spec <dir> to specify the spec file or directory');
  }
  seedDir = seedDir || specsDir;
  // Check environment variable for skip validation
  if (process.env.SKIP_VALIDATION === 'true') {
    skipValidation = true;
  }
  if (verbose) {
    console.log('\nDiscovering OpenAPI specifications...');
    console.log(`  Specs: ${specsDir}`);
    if (seedDir !== specsDir) console.log(`  Seed:  ${seedDir}`);
  }

  const apiSpecs = await loadAllSpecs({ specsDir });

  if (apiSpecs.length === 0) {
    throw new Error('No OpenAPI specifications found in specs directory');
  }

  if (verbose) {
    console.log(`✓ Discovered ${apiSpecs.length} API(s):`);
    apiSpecs.forEach(api => console.log(`  - ${api.title} (${api.name})`));
  }

  // Validate specs (unless skipped)
  if (!skipValidation) {
    if (verbose) {
      console.log('\nValidating specifications...');
    }

    const discoveredSpecs = discoverApiSpecs({ specsDir });

    const validationResults = await validateAll(discoveredSpecs);

    // Check for validation errors
    const hasErrors = Object.values(validationResults).some(r => !r.valid);

    if (verbose) {
      for (const [apiName, result] of Object.entries(validationResults)) {
        const status = getValidationStatus(result.spec);
        console.log(`  ${status.emoji} ${apiName}: ${status.message}`);
      }
    }

    if (hasErrors) {
      throw new Error('Validation failed. Run "npm run validate" for detailed errors.');
    }

    if (verbose) {
      console.log('✓ Validation passed');
    }
  }

  // Discover state machine contracts
  const stateMachines = discoverStateMachines(specsDir);
  if (verbose && stateMachines.length > 0) {
    console.log(`\n✓ Discovered ${stateMachines.length} state machine(s):`);
    stateMachines.forEach(sm => console.log(`  - ${sm.domain}/${sm.object}`));
  }

  // Discover SLA type contracts
  const slaTypes = discoverSlaTypes(specsDir);
  if (verbose && slaTypes.length > 0) {
    console.log(`\n✓ Discovered ${slaTypes.length} SLA type config(s):`);
    slaTypes.forEach(s => console.log(`  - ${s.domain} (${s.slaTypes.length} type(s))`));
  }

  // Discover composition definitions
  const compositions = contractsOfType(specsDir, 'compositions', 'compositions');
  if (verbose && compositions.length > 0) {
    console.log(`\n✓ Discovered ${compositions.length} composition file(s):`);
    compositions.forEach(c => console.log(`  - ${c.domain} (${Object.keys(c.doc.compositions || {}).length} composition(s))`));
  }

  // Discover rules files. Their decision graphs are compiled by generate —
  // the same build step the resolve pipeline runs — so the server evaluates
  // exactly what the pipeline would have written.
  const rulesFiles = contractsOfType(specsDir, 'rules', 'rulesets');
  const graphs = rulesFiles.length > 0
    ? generate(discover(specsDir).map(load), 'graph').map(({ graph }) => graph)
    : [];
  if (verbose && rulesFiles.length > 0) {
    console.log(`\n✓ Discovered ${rulesFiles.length} rules file(s):`);
    rulesFiles.forEach(r => console.log(`  - ${r.domain} (${Object.keys(r.doc.rulesets || {}).length} ruleset(s))`));
  }

  // Discover metric definition contracts
  const metrics = discoverMetrics(specsDir);
  if (verbose && metrics.length > 0) {
    console.log(`\n✓ Discovered ${metrics.length} metric definition(s):`);
    metrics.forEach(m => console.log(`  - ${m.domain} (${m.metrics.length} metric(s))`));
  }

  // Seed databases from example files
  const summary = seedAllDatabases(specsDir, seedDir);

  // Seed config-managed resources (after seedAllDatabases, which clears collections first)
  const configs = discoverConfigs(specsDir);
  for (const config of configs) {
    for (const [catalogKey, entries] of Object.entries(config.catalogs)) {
      for (const entry of entries) {
        // Strip x- extension fields before storing — they are config artifact metadata
        const { ...data } = entry;
        for (const key of Object.keys(data)) {
          if (key.startsWith('x-')) delete data[key];
        }
        insertResource(catalogKey, { ...data, source: 'system' });
        registerConfigManaged(catalogKey, data.id);
      }
      if (verbose) {
        console.log(`✓ Seeded ${entries.length} config-managed ${catalogKey} (${config.domain})`);
      }
    }
  }

  // Seed platform policy registry into the mock database
  const policies = registryEntries(discover(specsDir).map(load), 'policies');
  const policyEntries = Object.entries(policies);
  for (const [id, policy] of policyEntries) {
    insertResource('registry-policies', { id, ...policy, source: 'system' });
    registerConfigManaged('registry-policies', id);
  }
  if (verbose && policyEntries.length > 0) {
    console.log(`✓ Seeded ${policyEntries.length} config-managed registry-policies (platform)`);
  }

  // Validate seed data against schemas
  if (!skipValidation) {
    const seedErrors = validateMockData(specsDir, apiSpecs);
    if (seedErrors.length > 0) {
      const msg = seedErrors
        .map(e => `  ${e.api}${e.key ? ` [${e.key}]` : ''}: ${e.message}`)
        .join('\n');
      const looksLikeExpandMismatch = seedErrors.some(e =>
        e.message.includes("must have required property") ||
        e.message.includes("must NOT have additional properties")
      );
      const hint = looksLikeExpandMismatch
        ? '\n\nHint: If you are using an overlay with x-relationship.style: expand, ' +
          'your seed data must use the post-expansion field names (e.g., "person" not "personId"). ' +
          'Regenerate seed data from your resolved specs:\n' +
          `  npm run mock:seed -- --spec=${specsDir} --out=<seed-dir>`
        : '';
      throw new Error(`Seed data validation failed:\n${msg}${hint}`);
    }
    if (verbose) {
      console.log('✓ Seed data valid');
    }
  }

  return { apiSpecs, stateMachines, slaTypes, metrics, configs, compositions, rulesFiles, graphs, policies, summary };
}

/**
 * Contract documents of one type, in the shape the server's loaders expect.
 *
 * Replaces core's discoverRules/discoverCompositions: `discover` already
 * knows the type from the document's own $schema, so the only thing left is
 * to skip documents that declare none of the section the caller wants.
 *
 * @param {string} specsDir
 * @param {string} type - Contract type to discover
 * @param {string} section - Top-level key a usable document must declare
 * @returns {{ filePath: string, domain: string, doc: object }[]}
 */
function contractsOfType(specsDir, type, section) {
  return discover(specsDir, type)
    .map(load)
    .filter((doc) => doc.content?.[section])
    .map((doc) => ({ filePath: doc.path, domain: doc.content.domain, doc: doc.content }));
}

/**
 * Display setup summary
 * @param {Object} summary - Seeding summary
 */
export function displaySetupSummary(summary) {
  console.log('='.repeat(70));
  console.log('Setup Summary:');
  console.log('='.repeat(70));

  for (const [apiName, count] of Object.entries(summary)) {
    console.log(`  ${apiName}: ${count} resources`);
  }
}

/**
 * Merge every registry of one type into a map of ID to entry.
 *
 * Later documents override earlier ones per ID, which is how a state replaces
 * a baseline entry. `registry` is a contract type, so `discover` has already
 * tagged these; all that is left is the merge.
 *
 * @param {import('@codeforamerica/blueprint-core').Doc[]} docs
 * @param {string} type - Registry type, e.g. 'policies'
 * @returns {Record<string, object>}
 */
function registryEntries(docs, type) {
  const merged = {};
  for (const doc of docs) {
    if (doc.type !== 'registry' || doc.content?.type !== type) continue;
    Object.assign(merged, doc.content.entries ?? {});
  }
  return merged;
}
