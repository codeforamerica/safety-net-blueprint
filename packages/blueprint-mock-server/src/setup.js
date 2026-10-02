/**
 * Shared setup functionality for mock server
 * Handles loading specs and seeding databases
 */

import { apiSpecsFromDocs } from './spec-loader.js';
import { discoverApiSpecs } from './spec-discovery.js';
import { seedAllDatabases } from './seeder.js';
import { validateMockData } from './mock-data-validator.js';
import { validateAll, getValidationStatus } from './spec-validator.js';
import { initSchemaRegistry } from './validator.js';
import { registerConfigManaged } from './config-registry.js';
import { discover, load, extract } from '@codeforamerica/blueprint-core';
import { contractsOfType, graphsOf, unresolvedRulesWarning } from './contract-views.js';
/**
 * Perform setup: load specs and seed databases
 * @param {Object} options - Setup options
 * @param {string} options.specsDir - Path to specs directory (required)
 * @param {boolean} options.verbose - Show detailed output
 * @param {boolean} options.skipValidation - Skip validation step
 * @returns {Promise<Object>} Setup result with apiSpecs and summary
 */
export async function performSetup({ specsDir, seedDir, docs: providedDocs = null, verbose = true, skipValidation = false, store } = {}) {
  // Documents can arrive already loaded — from a contracts artifact, which is
  // a contract set someone else already walked and parsed (#448). Everything
  // after this point reads `docs` and cannot tell the difference.
  if (!specsDir && !providedDocs) {
    throw new Error('specsDir is required — pass --spec <dir> to specify the spec file or directory, or supply docs');
  }
  seedDir = seedDir || specsDir;
  // Check environment variable for skip validation
  if (process.env.SKIP_VALIDATION === 'true') {
    skipValidation = true;
  }
  if (verbose && providedDocs) {
    console.log(`\nReading ${providedDocs.length} document(s) from the contracts artifact...`);
    console.log('  Validated when the artifact was built; not re-checked here.');
  } else if (verbose) {
    console.log('\nDiscovering OpenAPI specifications...');
    console.log(`  Specs: ${specsDir}`);
    if (seedDir !== specsDir) console.log(`  Seed:  ${seedDir}`);
  }

  // One discovery pass for every contract type. This used to be ten walks of
  // the same directory — four loaders each doing their own recursive readdir,
  // plus discover() called separately for compositions, rules, graphs and the
  // policy registry. The loaders are gone; `extract` reads the same facts from
  // documents already in memory.
  // The seed directory's documents belong in the same set: seeding reads
  // mock-data documents through `extract(docs, 'examples')`, so they have to
  // be here rather than discovered separately inside the seeder.
  const docs = providedDocs ?? [
    ...discover(specsDir),
    ...(seedDir && seedDir !== specsDir ? discover(seedDir) : []),
  ].map(load);

  // Hand the request validator the set before any route is registered, so a
  // schema that still carries $refs can be resolved against it.
  initSchemaRegistry(docs);

  // From the documents already loaded, not a second walk of the same tree.
  const apiSpecs = apiSpecsFromDocs(docs);

  if (apiSpecs.length === 0) {
    throw new Error('No OpenAPI specifications found in specs directory');
  }

  if (verbose) {
    console.log(`✓ Discovered ${apiSpecs.length} API(s):`);
    apiSpecs.forEach(api => console.log(`  - ${api.title} (${api.name})`));
  }

  // Validate specs (unless skipped, or unless there are no files to validate).
  //
  // This check reads the spec files off disk — it dereferences each one to
  // confirm every $ref resolves, which is a question about the tree rather
  // than about the documents. An artifact has no tree: it was validated when
  // `blueprint-bundle-contracts` built it, which is the point at which the
  // files still existed, and it refuses to write an invalid set (#448).
  if (!skipValidation && !providedDocs) {
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
  const stateMachines = extract(docs, 'state-machines');
  if (verbose && stateMachines.length > 0) {
    console.log(`\n✓ Discovered ${stateMachines.length} state machine(s):`);
    stateMachines.forEach(sm => console.log(`  - ${sm.domain}/${sm.object}`));
  }

  // Discover SLA type contracts
  const slaTypes = extract(docs, 'sla-types');
  if (verbose && slaTypes.length > 0) {
    console.log(`\n✓ Discovered ${slaTypes.length} SLA type config(s):`);
    slaTypes.forEach(s => console.log(`  - ${s.domain} (${s.slaTypes.length} type(s))`));
  }

  // Discover composition definitions
  const compositions = contractsOfType(docs, 'compositions', 'compositions');
  if (verbose && compositions.length > 0) {
    console.log(`\n✓ Discovered ${compositions.length} composition file(s):`);
    compositions.forEach(c => console.log(`  - ${c.domain} (${Object.keys(c.doc.compositions || {}).length} composition(s))`));
  }

  // Decision graphs are read from the set, not compiled here. resolve wrote
  // one per ruleset beside its rules document, so recompiling produced the
  // identical bytes — and could stop doing so if the two ran under different
  // versions of the compiler.
  const rulesFiles = contractsOfType(docs, 'rules', 'rulesets');
  const graphs = graphsOf(docs);
  const unresolved = unresolvedRulesWarning(rulesFiles, graphs);
  if (unresolved) console.warn(`\nWarning: ${unresolved}`);
  if (verbose && rulesFiles.length > 0) {
    console.log(`\n✓ Discovered ${rulesFiles.length} rules file(s):`);
    rulesFiles.forEach(r => console.log(`  - ${r.domain} (${Object.keys(r.doc.rulesets || {}).length} ruleset(s))`));
  }

  // Discover metric definition contracts
  const metrics = extract(docs, 'metrics');
  if (verbose && metrics.length > 0) {
    console.log(`\n✓ Discovered ${metrics.length} metric definition(s):`);
    metrics.forEach(m => console.log(`  - ${m.domain} (${m.metrics.length} metric(s))`));
  }

  // Seed databases from example files
  // Seeding was asked for if a seed directory was given — or if the documents
  // were handed over already loaded, which is what a contracts artifact does.
  // An artifact has no seed directory and carries its mock-data documents in
  // the set, so keying off the directory alone left the store empty (#448).
  const summary = seedAllDatabases(docs, store, { seeded: Boolean(seedDir) || providedDocs !== null });

  // Seed config-managed resources (after seedAllDatabases, which clears collections first)
  const configs = extract(docs, 'config');
  for (const config of configs) {
    for (const [catalogKey, entries] of Object.entries(config.catalogs)) {
      for (const entry of entries) {
        // Strip x- extension fields before storing — they are config artifact metadata
        const { ...data } = entry;
        for (const key of Object.keys(data)) {
          if (key.startsWith('x-')) delete data[key];
        }
        store.insertResource(catalogKey, { ...data, source: 'system' });
        registerConfigManaged(catalogKey, data.id);
      }
      if (verbose) {
        console.log(`✓ Seeded ${entries.length} config-managed ${catalogKey} (${config.domain})`);
      }
    }
  }

  // Seed platform policy registry into the mock database
  const policies = extract(docs, 'registries').policies ?? {};
  const policyEntries = Object.entries(policies);
  for (const [id, policy] of policyEntries) {
    store.insertResource('registry-policies', { id, ...policy, source: 'system' });
    registerConfigManaged('registry-policies', id);
  }
  if (verbose && policyEntries.length > 0) {
    console.log(`✓ Seeded ${policyEntries.length} config-managed registry-policies (platform)`);
  }

  // Validate seed data against schemas
  if (!skipValidation) {
    const seedErrors = validateMockData(docs, apiSpecs);
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

  return { docs, apiSpecs, stateMachines, slaTypes, metrics, configs, compositions, rulesFiles, graphs, policies, summary };
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

