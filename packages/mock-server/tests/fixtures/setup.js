/**
 * Fixture directory setup for integration tests.
 *
 * Creates a temporary directory containing the real contract specs with
 * fixture seed files overlaid. Fixture seed files use the same key names
 * (*Example1) as the inline spec examples, but with stable, namespaced IDs
 * instead of placeholder UUIDs. This lets the Postman collection use
 * fixture IDs and gives tests predictable IDs to assert on.
 *
 * ID namespace map:
 *   00000001-*  persons
 *   00000002-*  users
 *   00000003-*  households
 *   00000004-*  applications
 *   00000005-*  cases
 *   00000006-*  incomes
 *   00000007-*  appointments
 *   00000008-*  queues
 *   00000009-*  tasks
 */

import { mkdtempSync, rmSync, cpSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONTRACTS_DIR = resolve(__dirname, '..', '..', '..', '..', 'packages', 'contracts');

/**
 * Create a temp directory with the real contract specs and fixture seed
 * data overlaid as the example files.
 * @returns {string} Path to the temp directory
 */
export function setupFixtureDir() {
  const tempDir = mkdtempSync(join(tmpdir(), 'snb-fixture-'));

  // Copy all contracts files (specs, state machines, rules, components, etc.)
  cpSync(CONTRACTS_DIR, tempDir, { recursive: true });

  // Overlay fixture yaml files, replacing the contracts example files
  const fixtureFiles = readdirSync(__dirname).filter(f => f.endsWith('.yaml'));
  for (const file of fixtureFiles) {
    cpSync(join(__dirname, file), join(tempDir, file));
  }

  return tempDir;
}

/**
 * Remove the temp directory created by setupFixtureDir.
 * @param {string} dir
 */
export function teardownFixtureDir(dir) {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
  }
}
