#!/usr/bin/env node
/**
 * State-specific OpenAPI Validation Script
 * Resolves overlays and validates the resulting specifications
 *
 * Usage:
 *   STATE=california node scripts/validate-state.js
 *   node scripts/validate-state.js --state=colorado
 *   node scripts/validate-state.js --all
 */

import { execSync, spawnSync } from 'child_process';
import { readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');
const overlaysDir = join(rootDir, 'openapi/overlays');
const resolvedDir = join(rootDir, 'openapi/resolved');

/**
 * Get available states from overlay directories
 */
function getAvailableStates() {
  if (!existsSync(overlaysDir)) {
    return [];
  }
  return readdirSync(overlaysDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(overlaysDir, entry.name, 'modifications.yaml')))
    .map(entry => entry.name);
}

/**
 * Get state from CLI args or environment
 */
function getState() {
  const args = process.argv.slice(2);

  // Check for --all flag
  if (args.includes('--all')) {
    return { all: true };
  }

  // Check for --state= argument
  const stateArg = args.find(arg => arg.startsWith('--state='));
  if (stateArg) {
    return { state: stateArg.split('=')[1] };
  }

  // Check environment variable
  if (process.env.STATE) {
    return { state: process.env.STATE };
  }

  return { state: null };
}

/**
 * Resolve overlay for a state
 */
function resolveOverlay(state) {
  console.log(`\nResolving overlay for: ${state}`);
  const result = spawnSync('node', [join(__dirname, 'resolve-overlay.js')], {
    env: { ...process.env, STATE: state },
    stdio: 'pipe',
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    console.error(`Failed to resolve overlay for ${state}`);
    console.error(result.stderr || result.stdout);
    return false;
  }

  // Print overlay output (includes warnings)
  if (result.stdout) {
    // Indent the output
    const lines = result.stdout.split('\n');
    for (const line of lines) {
      if (line.trim()) {
        console.log(`  ${line}`);
      }
    }
  }

  return true;
}

/**
 * Run validation against resolved specs
 * Uses spectral for linting and the syntax validator
 */
function runValidation(state) {
  console.log(`\nValidating resolved specs for: ${state}`);
  let hasErrors = false;

  // Run spectral lint against resolved specs
  console.log('  Running spectral lint...');
  const spectralResult = spawnSync('npx', [
    'spectral', 'lint',
    `${resolvedDir}/*.yaml`,
    '--ignore-unknown-format'
  ], {
    stdio: 'pipe',
    encoding: 'utf8',
    shell: true
  });

  if (spectralResult.stdout) {
    const lines = spectralResult.stdout.split('\n').filter(l => l.trim());
    if (lines.length > 0) {
      for (const line of lines) {
        console.log(`    ${line}`);
      }
    }
  }

  if (spectralResult.status !== 0) {
    if (spectralResult.stderr && !spectralResult.stderr.includes('No results')) {
      console.error(`    ${spectralResult.stderr}`);
    }
    // Spectral returns non-zero for warnings too, check output for errors
    if (spectralResult.stdout && spectralResult.stdout.includes('error')) {
      hasErrors = true;
    }
  }

  // Run pattern validation against resolved specs
  console.log('  Running pattern validation...');
  const patternResult = spawnSync('node', [
    join(__dirname, 'validate-patterns.js'),
    '--dir', resolvedDir
  ], {
    stdio: 'pipe',
    encoding: 'utf8'
  });

  if (patternResult.stdout) {
    const lines = patternResult.stdout.split('\n').filter(l => l.trim());
    for (const line of lines) {
      console.log(`    ${line}`);
    }
  }

  if (patternResult.status !== 0) {
    hasErrors = true;
    if (patternResult.stderr) {
      console.error(`    ${patternResult.stderr}`);
    }
  }

  return !hasErrors;
}

/**
 * Validate a single state
 */
function validateState(state) {
  console.log('='.repeat(70));
  console.log(`Validating state: ${state.toUpperCase()}`);
  console.log('='.repeat(70));

  // Resolve overlay
  if (!resolveOverlay(state)) {
    return false;
  }

  // Run validation
  return runValidation(state);
}

/**
 * Main function
 */
function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log('State-specific OpenAPI Validation\n');
    console.log('Usage:');
    console.log('  STATE=california npm run validate:state');
    console.log('  npm run validate:state -- --state=colorado');
    console.log('  npm run validate:all-states\n');
    console.log('Options:');
    console.log('  --state=NAME    Validate a specific state');
    console.log('  --all           Validate all available states');
    console.log('  -h, --help      Show this help message');
    process.exit(0);
  }

  const stateConfig = getState();
  const availableStates = getAvailableStates();

  if (availableStates.length === 0) {
    console.error('No state overlays found in openapi/overlays/');
    process.exit(1);
  }

  let allPassed = true;
  const results = {};

  if (stateConfig.all) {
    // Validate all states
    console.log('Validating all states:', availableStates.join(', '));
    console.log('');

    for (const state of availableStates) {
      const passed = validateState(state);
      results[state] = passed;
      if (!passed) {
        allPassed = false;
      }
      console.log('');
    }

    // Summary
    console.log('='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    for (const [state, passed] of Object.entries(results)) {
      const icon = passed ? '✓' : '✗';
      console.log(`  ${icon} ${state}`);
    }
    console.log('');

  } else if (stateConfig.state) {
    // Validate single state
    if (!availableStates.includes(stateConfig.state)) {
      console.error(`Unknown state: ${stateConfig.state}`);
      console.error(`Available states: ${availableStates.join(', ')}`);
      process.exit(1);
    }

    allPassed = validateState(stateConfig.state);
    console.log('');

  } else {
    // No state specified
    console.error('No state specified.');
    console.error('');
    console.error('Usage:');
    console.error('  STATE=california npm run validate:state');
    console.error('  npm run validate:state -- --state=colorado');
    console.error('  npm run validate:all-states');
    console.error('');
    console.error(`Available states: ${availableStates.join(', ')}`);
    process.exit(1);
  }

  if (allPassed) {
    console.log('✓ All validations passed!\n');
    process.exit(0);
  } else {
    console.log('✗ Validation failed\n');
    process.exit(1);
  }
}

main();
