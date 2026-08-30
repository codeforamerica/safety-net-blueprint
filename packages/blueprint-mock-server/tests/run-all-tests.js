/**
 * Run all mock server tests
 * Run with: node tests/mock-server/run-all-tests.js
 *
 * Options:
 *   --unit         Run only unit tests (default)
 *   --integration  Run only integration tests (requires mock server to be running)
 *   --functional   Run only functional tests (resolve + generate + server start/stop)
 *   --all          Run unit, integration, and functional tests
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { readdirSync, existsSync } from 'fs';
import { startMockServer, stopServer, isServerRunning } from '../cli/server.js';
import { setupFunctional, startFunctionalServer, stopFunctionalServer } from './functional/setup.js';
import { generatedContractsDir, rawContractsDir } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const seedDir = resolve(__dirname, '..', 'seed');

// Discover all test files in unit/ and integration/ directories
const unitDir = join(__dirname, 'unit');
const unitTestFiles = readdirSync(unitDir)
  .filter(file => file.endsWith('.test.js'))
  .map(file => join('unit', file));

const integrationDir = join(__dirname, 'integration');
const integrationTestFiles = readdirSync(integrationDir)
  .filter(file => file.endsWith('.test.js') || file.endsWith('.test.ts'))
  .map(file => join('integration', file));

const postmanDir = join(__dirname, 'integration', 'postman');
const postmanTestFiles = existsSync(postmanDir)
  ? readdirSync(postmanDir)
      .filter(file => file.endsWith('.test.js') || file.endsWith('.test.ts'))
      .map(file => join('integration', 'postman', file))
  : [];
const postmanCollections = existsSync(postmanDir)
  ? readdirSync(postmanDir)
      .filter(file => file.endsWith('.json'))
      .map(file => join('integration', 'postman', file))
  : [];

const functionalDir = join(__dirname, 'functional');
const functionalTestFiles = existsSync(functionalDir)
  ? readdirSync(functionalDir)
      .filter(file => file.endsWith('.test.ts') || file.endsWith('.test.js'))
      .map(file => join('functional', file))
  : [];

const args = process.argv.slice(2);
const runUnit = args.includes('--unit') || args.includes('--all') || args.length === 0;
const runIntegration = args.includes('--integration') || args.includes('--all');
const runFunctional = args.includes('--functional') || args.includes('--all');

async function runTest(testFile) {
  return new Promise((resolve, reject) => {
    const testPath = join(__dirname, testFile);
    console.log(`\n${'='.repeat(70)}`);
    console.log(`Running: ${testFile}`);
    console.log('='.repeat(70));

    const isTs = testFile.endsWith('.ts');
    const tsxLocal = join(__dirname, '..', 'node_modules', '.bin', 'tsx');
    const tsxRoot = join(__dirname, '..', '..', '..', 'node_modules', '.bin', 'tsx');
    const tsxBin = existsSync(tsxLocal) ? tsxLocal : tsxRoot;
    const runner = isTs ? tsxBin : 'node';
    const runnerArgs = isTs ? ['--test', testPath] : [testPath];
    // Close fd3 for tsx/--test runs: Node.js test runner uses fd3 for its IPC
    // pipe between the orchestrator and the test file subprocess. If fd3 is
    // already open in the environment (e.g. bash's exec > >(tee ...) pipe from
    // preflight.sh, or npm's internal pipes), tsx inherits it and the IPC
    // channel gets corrupted, causing "Unable to deserialize cloned data".
    const proc = spawn(runner, runnerArgs, {
      stdio: isTs ? ['inherit', 'inherit', 'inherit', 'ignore'] : 'inherit',
      shell: !isTs && process.platform === 'win32'
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(true);
      } else {
        reject(new Error(`Test ${testFile} failed with exit code ${code}`));
      }
    });

    proc.on('error', (error) => {
      reject(error);
    });
  });
}

const TEST_TIMEOUT_MS = 5 * 60 * 1000;   // 5 minutes per test file
const SETUP_TIMEOUT_MS = 3 * 60 * 1000;  // 3 minutes for resolve/generate steps

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runPostmanCollection(collectionFile) {
  return new Promise((resolve, reject) => {
    const collectionPath = join(__dirname, collectionFile);
    console.log(`\n${'='.repeat(70)}`);
    console.log(`Running Postman collection: ${collectionFile}`);
    console.log('='.repeat(70));

    const proc = spawn('npx', ['newman', 'run', collectionPath, '--reporters', 'cli'], {
      stdio: 'inherit',
      shell: true
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(true);
      } else {
        reject(new Error(`Postman collection ${collectionFile} failed with exit code ${code}`));
      }
    });

    proc.on('error', (error) => {
      reject(error);
    });
  });
}

const generatedDir = join(__dirname, 'integration', 'generated');
const generateTestClientsScript = resolve(__dirname, '..', 'cli', 'generate-test-clients.js');
const resolveScript = resolve(__dirname, '..', '..', 'blueprint-cli', 'scripts', 'resolve.js');

/**
 * Run the main contracts resolve pipeline (base specs + overlay → packages/generated).
 */
async function resolveContracts() {
  console.log('Resolving contracts...');
  await new Promise((res, rej) => {
    const proc = spawn('node', [resolveScript, `--spec=${rawContractsDir}`, `--overlay=${join(rawContractsDir, 'overlays')}`, `--out=${generatedContractsDir}`], { stdio: 'inherit', shell: false });
    proc.on('close', code => code === 0 ? res() : rej(new Error(`resolve failed with exit code ${code}`)));
    proc.on('error', rej);
  });
}

/**
 * Generate TypeScript clients for integration tests from already-resolved specs.
 */
async function ensureIntegrationClients() {
  if (existsSync(generatedDir) && readdirSync(generatedDir).length > 0) return;
  console.log('Generated clients not found — running clients:generate...');
  await new Promise((res, rej) => {
    const proc = spawn('node', [generateTestClientsScript], { stdio: 'inherit', shell: false });
    proc.on('close', code => code === 0 ? res() : rej(new Error(`clients:generate failed with exit code ${code}`)));
    proc.on('error', rej);
  });
}

async function runAllTests() {
  console.log('Mock Server Test Suite');
  console.log('='.repeat(70));

  if (runUnit) console.log(`  Unit:        ${unitTestFiles.length} test(s)`);
  if (runIntegration) console.log(`  Integration: ${integrationTestFiles.length} test(s), ${postmanTestFiles.length} Postman test(s), ${postmanCollections.length} Postman collection(s)`);
  if (runFunctional) console.log(`  Functional:  ${functionalTestFiles.length} test(s)`);

  let passed = 0;
  let failed = 0;
  const failedTests = [];

  let integrationServerStarted = false;
  let functionalServerStarted = false;

  async function bail(label, error) {
    failed++;
    failedTests.push(label);
    console.error(`\n✗ ${label} failed: ${error.message}`);
    console.error('\nStopping — fix the failure above before continuing.');
    console.error(`  ✗ ${label}`);
    if (integrationServerStarted) await stopServer(false).catch(() => {});
    if (functionalServerStarted) await stopFunctionalServer().catch(() => {});
    process.exit(1);
  }

  // Run resolve pipelines before starting any servers.
  // When both integration and functional are needed, run both resolve pipelines
  // concurrently — they write to different output dirs and are fully independent.
  if (runIntegration && runFunctional) {
    console.log('\nRunning resolve pipelines in parallel...');
    await Promise.all([
      withTimeout(resolveContracts(), SETUP_TIMEOUT_MS, 'resolveContracts'),
      withTimeout(setupFunctional(), SETUP_TIMEOUT_MS, 'setupFunctional'),
    ]).catch(err => bail('resolve pipelines', err));
    await withTimeout(ensureIntegrationClients(), SETUP_TIMEOUT_MS, 'ensureIntegrationClients')
      .catch(err => bail('ensureIntegrationClients', err));
  } else if (runIntegration) {
    await withTimeout(resolveContracts(), SETUP_TIMEOUT_MS, 'resolveContracts')
      .catch(err => bail('resolveContracts', err));
    await withTimeout(ensureIntegrationClients(), SETUP_TIMEOUT_MS, 'ensureIntegrationClients')
      .catch(err => bail('ensureIntegrationClients', err));
  } else if (runFunctional) {
    await withTimeout(setupFunctional(), SETUP_TIMEOUT_MS, 'setupFunctional')
      .catch(err => bail('setupFunctional', err));
  }

  // Run unit tests
  if (runUnit) {
    console.log('\n📋 Unit Tests');
    console.log('-'.repeat(70));
    for (const testFile of unitTestFiles) {
      await withTimeout(runTest(testFile), TEST_TIMEOUT_MS, testFile)
        .then(() => passed++)
        .catch(err => bail(testFile, err));
    }
  }

  // Run integration tests if requested
  if (runIntegration) {
    console.log('\n🔗 Integration Tests');
    console.log('-'.repeat(70));

    // Start the mock server once for all integration and Postman tests.
    // Individual test files check isServerRunning() and skip startup when
    // the server is already available, so teardownServer() is a no-op for them.
    const integrationResolvedDir = generatedContractsDir;
    const integrationSeedDir = resolve(__dirname, 'integration', 'seed');
    const integrationAlreadyRunning = await isServerRunning().catch(() => false);
    if (!integrationAlreadyRunning) {
      console.log('Starting mock server...');
      await startMockServer([integrationResolvedDir], integrationSeedDir);
      await new Promise(res => setTimeout(res, 1500));
      integrationServerStarted = true;
      console.log('Mock server started\n');
    }

    for (const testFile of integrationTestFiles) {
      await withTimeout(runTest(testFile), TEST_TIMEOUT_MS, testFile)
        .then(() => passed++)
        .catch(err => bail(testFile, err));
    }

    if (postmanTestFiles.length > 0 || postmanCollections.length > 0) {
      console.log('\n📮 Postman Tests');
      console.log('-'.repeat(70));

      for (const testFile of postmanTestFiles) {
        await withTimeout(runTest(testFile), TEST_TIMEOUT_MS, testFile)
          .then(() => passed++)
          .catch(err => bail(testFile, err));
      }

      for (const collectionFile of postmanCollections) {
        await withTimeout(runPostmanCollection(collectionFile), TEST_TIMEOUT_MS, collectionFile)
          .then(() => passed++)
          .catch(err => bail(collectionFile, err));
      }
    }

    if (integrationServerStarted) await stopServer(false);
    integrationServerStarted = false;
  }

  // Run functional tests if requested
  if (runFunctional) {
    console.log('\n🧪 Functional Tests');
    console.log('-'.repeat(70));

    console.log('Starting functional server...');
    await startFunctionalServer();
    functionalServerStarted = true;
    await new Promise(res => setTimeout(res, 1500));
    console.log('Functional server started\n');

    for (const testFile of functionalTestFiles) {
      await withTimeout(runTest(testFile), TEST_TIMEOUT_MS, testFile)
        .then(() => passed++)
        .catch(err => bail(testFile, err));
    }

    await stopFunctionalServer();
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('Test Suite Summary');
  console.log('='.repeat(70));
  console.log(`Total tests: ${passed + failed}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  
  if (failedTests.length > 0) {
    console.log(`\nFailed tests:`);
    failedTests.forEach(test => console.log(`  - ${test}`));
  }
  
  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('\n✓ All tests passed!');
  }
}

runAllTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});

