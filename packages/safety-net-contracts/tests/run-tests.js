#!/usr/bin/env node
/**
 * Test runner for safety-net-contracts.
 *
 * Options:
 *   --unit                Run unit tests (default when no flag given)
 *   --integration         Run integration tests
 *   --all                 Run unit and integration tests
 *   --contracts=<path>    Path to resolved contracts dir (required for integration)
 *   --seed=<path>         Path to seed data dir (required for integration)
 *   --stop                Stop the mock server after integration tests complete
 */

import { spawn } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync, existsSync } from 'fs';
import { startMockServer, stopServer, isServerRunning } from '@codeforamerica/blueprint-mock-server';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const contractsArg   = args.find(a => a.startsWith('--contracts='));
const seedArg        = args.find(a => a.startsWith('--seed='));
const clientsArg     = args.find(a => a.startsWith('--clients='));
const specArg        = args.find(a => a.startsWith('--spec='));
const contractsDir   = contractsArg ? resolve(process.cwd(), contractsArg.slice('--contracts='.length)) : null;
const seedDir        = seedArg      ? resolve(process.cwd(), seedArg.slice('--seed='.length))           : null;
const clientsDir     = clientsArg   ? resolve(process.cwd(), clientsArg.slice('--clients='.length))     : null;
const specDir        = specArg      ? resolve(process.cwd(), specArg.slice('--spec='.length))           : null;
const doStop         = args.includes('--stop');
const runUnit        = args.includes('--unit') || args.includes('--all') || args.length === 0;
const runIntegration = args.includes('--integration') || args.includes('--all');

const unitDir        = join(__dirname, 'unit');
const integrationDir = join(__dirname, 'integration');

const unitTestFiles = existsSync(unitDir)
  ? readdirSync(unitDir)
    .filter(f => f.endsWith('.test.js') || f.endsWith('.test.ts'))
    .map(f => join('unit', f))
  : [];

const integrationTestFiles = existsSync(integrationDir)
  ? readdirSync(integrationDir)
    .filter(f => f.endsWith('.test.js') || f.endsWith('.test.ts'))
    .map(f => join('integration', f))
  : [];

const TEST_TIMEOUT_MS = 5 * 60 * 1000;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function runTest(testFile, extraArgs = []) {
  return new Promise((res, rej) => {
    const testPath = join(__dirname, testFile);
    console.log(`\n${'='.repeat(70)}`);
    console.log(`Running: ${testFile}`);
    console.log('='.repeat(70));

    const isTs   = testFile.endsWith('.ts');
    const tsxLocal = join(__dirname, '..', 'node_modules', '.bin', 'tsx');
    const tsxRoot  = join(__dirname, '..', '..', '..', 'node_modules', '.bin', 'tsx');
    const tsxBin   = existsSync(tsxLocal) ? tsxLocal : tsxRoot;
    const runner     = isTs ? tsxBin : 'node';
    // tsx is run without --test: node:test's describe/it/before work as a
    // standalone script, and this lets extra args (--contracts=, --clients=,
    // etc.) land in process.argv rather than being misinterpreted as test
    // file patterns by the Node.js test runner orchestrator.
    const runnerArgs = [testPath, ...extraArgs];

    const proc = spawn(runner, runnerArgs, {
      stdio: 'inherit',
      shell: !isTs && process.platform === 'win32',
    });
    proc.on('close', code => code === 0 ? res(true) : rej(new Error(`${testFile} failed with exit code ${code}`)));
    proc.on('error', rej);
  });
}

async function runAllTests() {
  console.log('Safety Net Contracts Test Suite');
  console.log('='.repeat(70));
  if (runUnit)        console.log(`  Unit:        ${unitTestFiles.length} test(s)`);
  if (runIntegration) console.log(`  Integration: ${integrationTestFiles.length} test(s)`);

  let passed = 0;
  let failed = 0;
  const failedTests = [];

  async function bail(label, error) {
    failed++;
    failedTests.push(label);
    console.error(`\n✗ ${label} failed: ${error.message}`);
    console.error('\nStopping — fix the failure above before continuing.');
    if (doStop) await stopServer(false).catch(() => {});
    process.exit(1);
  }

  if (runIntegration) {
    if (!contractsDir || !seedDir) { console.error('--contracts and --seed are required for integration tests'); process.exit(1); }

    const alreadyRunning = await isServerRunning().catch(() => false);
    if (!alreadyRunning) {
      console.log('Starting mock server...');
      await startMockServer([contractsDir], seedDir);
      await new Promise(res => setTimeout(res, 1500));
      console.log('Mock server started\n');
    } else {
      console.log('Using existing mock server\n');
    }
  }

  if (runUnit) {
    console.log('\nUnit Tests');
    console.log('-'.repeat(70));
    const unitArgs = specDir ? [`--spec=${specDir}`] : [];
    for (const testFile of unitTestFiles) {
      await withTimeout(runTest(testFile, unitArgs), TEST_TIMEOUT_MS, testFile)
        .then(() => passed++)
        .catch(err => bail(testFile, err));
    }
  }

  if (runIntegration) {
    console.log('\nIntegration Tests');
    console.log('-'.repeat(70));
    const integrationArgs = [
      `--contracts=${contractsDir}`,
      `--seed=${seedDir}`,
      ...(clientsDir ? [`--clients=${clientsDir}`] : []),
    ];
    for (const testFile of integrationTestFiles) {
      await withTimeout(runTest(testFile, integrationArgs), TEST_TIMEOUT_MS, testFile)
        .then(() => passed++)
        .catch(err => bail(testFile, err));
    }
  }

  if (doStop) await stopServer(false);

  console.log('\n' + '='.repeat(70));
  console.log('Test Suite Summary');
  console.log('='.repeat(70));
  console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);

  if (failed > 0) {
    failedTests.forEach(t => console.log(`  ✗ ${t}`));
    process.exit(1);
  } else {
    console.log('\nAll tests passed!');
  }
}

runAllTests().catch(err => { console.error(err); process.exit(1); });
