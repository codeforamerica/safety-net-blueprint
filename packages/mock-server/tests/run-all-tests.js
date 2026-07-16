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
import { startMockServer, stopServer, isServerRunning } from '../scripts/server.js';
import { setupFunctional, startFunctionalServer, stopFunctionalServer } from './e2e/functional/setup.js';

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

const postmanDir = join(__dirname, 'postman');
const postmanCollections = existsSync(postmanDir)
  ? readdirSync(postmanDir)
      .filter(file => file.endsWith('.json'))
      .map(file => join('postman', file))
  : [];

const functionalDir = join(__dirname, 'e2e', 'functional');
const functionalTestFiles = existsSync(functionalDir)
  ? readdirSync(functionalDir)
      .filter(file => file.endsWith('.test.ts') || file.endsWith('.test.js'))
      .map(file => join('e2e', 'functional', file))
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
    const proc = spawn(runner, runnerArgs, {
      stdio: 'inherit',
      shell: true
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

const generatedDir = join(__dirname, 'generated');
const generateTestClientsScript = resolve(__dirname, '..', 'scripts', 'generate-test-clients.js');

/**
 * Ensure generated TypeScript clients exist for integration tests.
 * Checks for the generated/ directory and runs generate-test-clients.js if missing.
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
  if (runIntegration) console.log(`  Integration: ${integrationTestFiles.length} test(s), ${postmanCollections.length} Postman collection(s)`);
  if (runFunctional) console.log(`  Functional:  ${functionalTestFiles.length} test(s)`);

  let passed = 0;
  let failed = 0;
  const failedTests = [];

  // Run unit tests
  if (runUnit) {
    console.log('\n📋 Unit Tests');
    console.log('-'.repeat(70));
    for (const testFile of unitTestFiles) {
      try {
        await runTest(testFile);
        passed++;
      } catch (error) {
        failed++;
        failedTests.push(testFile);
        console.error(`\n✗ ${testFile} failed: ${error.message}`);
      }
    }
  }

  // Run integration tests if requested
  if (runIntegration) {
    await ensureIntegrationClients();
    console.log('\n🔗 Integration Tests');
    console.log('-'.repeat(70));
    for (const testFile of integrationTestFiles) {
      try {
        await runTest(testFile);
        passed++;
      } catch (error) {
        failed++;
        failedTests.push(testFile);
        console.error(`\n✗ ${testFile} failed: ${error.message}`);
        console.error('   Make sure the mock server is running: npm run mock:start');
      }
    }

    if (postmanCollections.length > 0) {
      console.log('\n📮 Postman Collections');
      console.log('-'.repeat(70));

      const contractsDir = resolve(__dirname, '..', '..', 'contracts');
      const alreadyRunning = await isServerRunning().catch(() => false);
      if (!alreadyRunning) {
        console.log('Starting mock server...');
        await startMockServer([contractsDir], seedDir);
        await new Promise(res => setTimeout(res, 1500));
        console.log('Mock server started\n');
      }

      for (const collectionFile of postmanCollections) {
        try {
          await runPostmanCollection(collectionFile);
          passed++;
        } catch (error) {
          failed++;
          failedTests.push(collectionFile);
          console.error(`\n✗ ${collectionFile} failed: ${error.message}`);
          console.error('   Make sure the mock server is running: npm run mock:start');
        }
      }

      if (!alreadyRunning) await stopServer(false);
    }
  }

  // Run functional tests if requested
  if (runFunctional) {
    console.log('\n🧪 Functional Tests');
    console.log('-'.repeat(70));

    // Run the resolve + generate pipeline before starting the server
    console.log('Running setup (resolve + generate)...');
    try {
      await setupFunctional();
    } catch (error) {
      failed++;
      failedTests.push('functional/setup');
      console.error(`\n✗ Functional setup failed: ${error.message}`);
      console.error('   Skipping functional tests.');
    }

    if (!failedTests.includes('functional/setup')) {
      console.log('Starting functional server...');
      await startFunctionalServer();
      await new Promise(res => setTimeout(res, 1500));
      console.log('Functional server started\n');

      for (const testFile of functionalTestFiles) {
        try {
          await runTest(testFile);
          passed++;
        } catch (error) {
          failed++;
          failedTests.push(testFile);
          console.error(`\n✗ ${testFile} failed: ${error.message}`);
        }
      }

      await stopFunctionalServer();
    }
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

