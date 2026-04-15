/**
 * Shared setup functionality for mock server
 * Handles loading specs and seeding databases
 */

import { loadAllSpecs, discoverApiSpecs } from '@codeforamerica/safety-net-blueprint-contracts/loader';
import { seedAllDatabases } from './seeder.js';
import { validateSeedData } from './seed-validator.js';
import { validateAll, getValidationStatus } from '@codeforamerica/safety-net-blueprint-contracts/validation';
import { discoverStateMachines } from './state-machine-loader.js';
import { discoverRules } from './rules-loader.js';
import { discoverSlaTypes } from './sla-loader.js';
import { discoverMetrics } from './metrics-loader.js';
import { discoverConfigs } from './config-loader.js';
import { insertResource } from './database-manager.js';
import { registerConfigManaged } from './config-registry.js';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

  // Discover rule contracts
  const rules = discoverRules(specsDir);
  if (verbose && rules.length > 0) {
    console.log(`\n✓ Discovered ${rules.length} rule set(s):`);
    rules.forEach(r => console.log(`  - ${r.domain} (${r.ruleSets.length} ruleSet(s))`));
  }

  // Discover SLA type contracts
  const slaTypes = discoverSlaTypes(specsDir);
  if (verbose && slaTypes.length > 0) {
    console.log(`\n✓ Discovered ${slaTypes.length} SLA type config(s):`);
    slaTypes.forEach(s => console.log(`  - ${s.domain} (${s.slaTypes.length} type(s))`));
  }

  // Discover metric definition contracts
  const metrics = discoverMetrics(specsDir);
  if (verbose && metrics.length > 0) {
    console.log(`\n✓ Discovered ${metrics.length} metric definition(s):`);
    metrics.forEach(m => console.log(`  - ${m.domain} (${m.metrics.length} metric(s))`));
  }

  // Seed databases from example files
  const summary = seedAllDatabases(apiSpecs, specsDir, seedDir);

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

  // Validate seed data against schemas
  if (!skipValidation) {
    const seedErrors = validateSeedData(seedDir, apiSpecs);
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

  return { apiSpecs, stateMachines, rules, slaTypes, metrics, configs, summary };
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

