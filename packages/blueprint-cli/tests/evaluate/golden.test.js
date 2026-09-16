/**
 * Golden file tests for blueprint-evaluate CLI.
 *
 * Runs the evaluate script against the shared fixture rules examples file, and
 * compares stdout against a committed golden JSON file character-for-character.
 *
 * Fixture input:   tests/fixtures/alerts-rules-examples.yaml
 * Golden output:   tests/evaluate/golden/
 *
 * To regenerate golden outputs:
 *   node scripts/evaluate.js tests/fixtures/alerts-rules-examples.yaml \
 *     > tests/evaluate/golden/rules-examples-batch.json
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '../../scripts/evaluate.js');
const SHARED = join(__dirname, '../fixtures');
const GOLDEN = join(__dirname, 'golden');

function run(...args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

describe('evaluate golden', () => {
  it('rules examples file batch output matches golden', () => {
    const { status, stdout, stderr } = run(
      `--spec=${join(SHARED, 'alerts-rules-examples.yaml')}`,
    );
    assert.equal(status, 0, `script failed:\n${stderr}`);
    const golden = readFileSync(join(GOLDEN, 'rules-examples-batch.json'), 'utf8');
    assert.strictEqual(stdout, golden,
      'output differs from golden — run `npm run test:goldens-regenerate` if intentional');
  });
});
