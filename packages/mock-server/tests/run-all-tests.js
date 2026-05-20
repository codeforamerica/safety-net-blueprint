/**
 * Run all mock server tests
 * Run with: node tests/mock-server/run-all-tests.js
 * 
 * Options:
 *   --unit         Run only unit tests (default)
 *   --integration  Run only integration tests (requires mock server to be running)
 *   --all          Run both unit and integration tests
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { readdirSync, existsSync } from 'fs';
import { startMockServer, stopServer, isServerRunning } from '../scripts/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Discover all test files in unit/ and integration/ directories
const unitDir = join(__dirname, 'unit');
const unitTestFiles = readdirSync(unitDir)
  .filter(file => file.endsWith('.test.js'))
  .map(file => join('unit', file));

const integrationDir = join(__dirname, 'integration');
const integrationTestFiles = readdirSync(integrationDir)
  .filter(file => file.endsWith('.test.js'))
  .map(file => join('integration', file));

const postmanDir = join(__dirname, 'postman');
const postmanCollections = existsSync(postmanDir)
  ? readdirSync(postmanDir)
      .filter(file => file.endsWith('.json'))
      .map(file => join('postman', file))
  : [];

const args = process.argv.slice(2);
const runUnit = args.includes('--unit') || args.includes('--all') || args.length === 0;
const runIntegration = args.includes('--integration') || args.includes('--all');

async function runTest(testFile) {
  return new Promise((resolve, reject) => {
    const testPath = join(__dirname, testFile);
    console.log(`\n${'='.repeat(70)}`);
    console.log(`Running: ${testFile}`);
    console.log('='.repeat(70));

    const proc = spawn('node', [testPath], {
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

async function runAllTests() {
  console.log('Mock Server Test Suite');
  console.log('='.repeat(70));
  
  if (runUnit && runIntegration) {
    console.log(`Running ${unitTestFiles.length} unit test(s), ${integrationTestFiles.length} integration test(s), and ${postmanCollections.length} Postman collection(s)...`);
  } else if (runUnit) {
    console.log(`Running ${unitTestFiles.length} unit test(s)...`);
  } else if (runIntegration) {
    console.log(`Running ${integrationTestFiles.length} integration test(s) and ${postmanCollections.length} Postman collection(s) (requires mock server)...`);
  }
  
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
        await startMockServer([contractsDir]);
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

