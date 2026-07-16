/**
 * Shared setup for functional tests.
 *
 * Discovers all *-openapi.yaml fixtures, resolves them through the overlay
 * pipeline, generates TypeScript clients, and provides server start/stop helpers.
 *
 * Use from run-all-tests.js (--functional flag) or directly:
 *   node tests/e2e/functional/setup.js
 */

import { spawn } from 'child_process';
import { readdirSync, mkdirSync } from 'fs';
import { join, resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { startMockServer, stopServer } from '../../../scripts/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixturesDir = join(__dirname, 'fixtures');
export const resolvedDir = join(__dirname, 'resolved');
export const generatedDir = join(__dirname, 'generated', 'typescript');

// Path to contracts resolve.js (relative to mock-server package → contracts package)
const resolveScript = resolve(__dirname, '..', '..', '..', '..', 'contracts', 'scripts', 'resolve.js');
// Path to generate-clients-typescript.js (in clients package)
const generateScript = resolve(__dirname, '..', '..', '..', '..', 'clients', 'scripts', 'generate-clients-typescript.js');

/**
 * Spawn a node script and wait for it to complete.
 * @param {string} scriptPath - Absolute path to the script
 * @param {string[]} args - CLI args to pass
 * @returns {Promise<void>}
 */
function runScript(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [scriptPath, ...args], { stdio: 'inherit', shell: false });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Script ${basename(scriptPath)} exited with code ${code}`));
      }
    });
    proc.on('error', reject);
  });
}

/**
 * Resolve all *-openapi.yaml fixtures and generate TypeScript clients.
 * Resolves the entire fixtures directory in one pass (so resolve.js cleans
 * and rewrites resolvedDir in one go), then generates clients from the result.
 * @returns {Promise<void>}
 */
export async function setupFunctional() {
  const fixtures = readdirSync(fixturesDir).filter(f => f.endsWith('-openapi.yaml'));

  if (fixtures.length === 0) {
    console.log('No fixture specs found in', fixturesDir);
    return;
  }

  console.log(`\nResolving ${fixtures.length} fixture spec(s)...`);
  // Resolve entire fixtures directory into resolvedDir in one pass.
  // resolve.js discovers all *-openapi.yaml files in the spec dir and copies
  // them to outDir, applying relationship resolution on the way.
  await runScript(resolveScript, [`--spec=${fixturesDir}`, `--out=${resolvedDir}`, '--resolve', '--bundle']);

  // Generate TypeScript clients for all resolved specs
  console.log('\nGenerating TypeScript clients...');
  await runScript(generateScript, [`--spec=${resolvedDir}`, `--out=${generatedDir}`]);

  console.log('\nFunctional test setup complete.');
}

/**
 * Start the mock server pointing at the resolved fixtures directory.
 * @returns {Promise<void>}
 */
export async function startFunctionalServer() {
  await startMockServer([resolvedDir]);
}

/**
 * Stop the mock server.
 * @returns {Promise<void>}
 */
export async function stopFunctionalServer() {
  await stopServer(false);
}

// When run directly, execute the full setup (resolve + generate) and exit
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  setupFunctional().catch((err) => {
    console.error('Setup failed:', err);
    process.exit(1);
  });
}
