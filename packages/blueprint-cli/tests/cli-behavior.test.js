/**
 * Generic CLI behavior tests for all blueprint-cli scripts.
 *
 * Tests behaviors that every script should exhibit regardless of domain:
 * - Exits 1 when required args are missing
 * - Exits 1 when an unknown flag is passed
 *
 * For script-specific behavior and output correctness, see the golden and
 * integration tests in each script's subdirectory.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(__dirname, '../scripts');

function run(script, ...args) {
  return spawnSync(process.execPath, [join(SCRIPTS, script), ...args], { encoding: 'utf8' });
}

const SCRIPTS_REQUIRING_ARGS = [
  'resolve.js',
  'evaluate.js',
  'export-schemas.js',
  'generate-ts-clients.js',
  'generate-postman-collection.js',
  'scaffold-api.js',
  'add-api-resource.js',
];

const ALL_SCRIPTS = [
  ...SCRIPTS_REQUIRING_ARGS,
  'generate-rpc-overlay.js',
];

describe('cli behavior — missing required args', () => {
  for (const script of SCRIPTS_REQUIRING_ARGS) {
    it(`${script} exits 1 with no args`, () => {
      const { status } = run(script);
      assert.equal(status, 1, `${script} should exit 1 when required args are missing`);
    });
  }
});

describe('cli behavior — unknown flags', () => {
  for (const script of ALL_SCRIPTS) {
    it(`${script} exits 1 with an unknown flag`, () => {
      const { status } = run(script, '--unknown-flag-xyz');
      assert.equal(status, 1, `${script} should exit 1 for unknown flags`);
    });
  }
});
