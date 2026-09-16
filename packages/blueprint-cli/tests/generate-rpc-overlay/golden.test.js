/**
 * Golden file tests for blueprint-generate-rpc-overlay CLI.
 *
 * Copies shared fixtures to a temp directory, runs the overlay generator,
 * and compares the generated overlay YAML against the committed golden.
 *
 * Shared inputs:  tests/fixtures/
 * Golden outputs: tests/generate-rpc-overlay/golden/
 *
 * To regenerate golden outputs:
 *   cp -r tests/fixtures /tmp/snb-rpc-regen && \
 *   node scripts/generate-rpc-overlay.js --spec=/tmp/snb-rpc-regen && \
 *   cp /tmp/snb-rpc-regen/overlays/alerts-rpc.yaml tests/generate-rpc-overlay/golden/
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '../../scripts/generate-rpc-overlay.js');
const INPUTS = join(__dirname, '../fixtures');
const GOLDEN = join(__dirname, 'golden');

const GOLDEN_FILES = [
  'alerts-rpc.yaml',
];

describe('generate-rpc-overlay golden', () => {
  let workDir;

  before(() => {
    workDir = mkdtempSync(join(tmpdir(), 'snb-rpc-overlay-golden-'));
    cpSync(INPUTS, workDir, { recursive: true });
    const result = spawnSync(process.execPath, [SCRIPT, `--spec=${workDir}`], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `generate-rpc-overlay failed:\n${result.stderr}`);
  });

  after(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  for (const file of GOLDEN_FILES) {
    it(`${file} matches golden`, () => {
      const actual = readFileSync(join(workDir, 'overlays', file), 'utf8');
      const golden = readFileSync(join(GOLDEN, file), 'utf8');
      assert.strictEqual(actual, golden,
        `${file} differs from golden — run \`npm run test:goldens-regenerate\` if intentional`);
    });
  }
});
