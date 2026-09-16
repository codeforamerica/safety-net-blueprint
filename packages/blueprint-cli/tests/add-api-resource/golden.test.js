/**
 * Golden file tests for blueprint-add-api-resource CLI.
 *
 * Copies the shared fixture input spec to a temp directory, runs add-api-resource
 * to add a new resource, and compares the result against the committed golden.
 *
 * Fixture inputs:  tests/fixtures/
 * Golden outputs:  tests/add-api-resource/golden/
 *
 * To regenerate golden outputs:
 *   cp tests/fixtures/alerts-openapi.yaml /tmp/snb-add-api-resource-regen/
 *   node scripts/add-api-resource.js \
 *     --name alerts --resource Subscription \
 *     --out /tmp/snb-add-api-resource-regen
 *   cp /tmp/snb-add-api-resource-regen/alerts-openapi.yaml tests/add-api-resource/golden/
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '../../scripts/add-api-resource.js');
const INPUTS = join(__dirname, '../fixtures');
const OUTPUTS = join(__dirname, 'golden');

const GOLDEN_FILES = [
  'alerts-openapi.yaml',
];

describe('add-api-resource golden', () => {
  let workDir;

  before(() => {
    workDir = mkdtempSync(join(tmpdir(), 'snb-add-api-resource-golden-'));
    copyFileSync(
      join(INPUTS, 'alerts-openapi.yaml'),
      join(workDir, 'alerts-openapi.yaml'),
    );
    const result = spawnSync(
      process.execPath,
      [SCRIPT, '--name', 'alerts', '--resource', 'Subscription', '--out', workDir],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `add-api-resource failed:\n${result.stderr}`);
  });

  after(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  for (const file of GOLDEN_FILES) {
    it(`${file} matches golden`, () => {
      const actual = readFileSync(join(workDir, file), 'utf8');
      const golden = readFileSync(join(OUTPUTS, file), 'utf8');
      assert.strictEqual(actual, golden,
        `${file} differs from golden — run \`npm run test:goldens-regenerate\` if intentional`);
    });
  }
});
