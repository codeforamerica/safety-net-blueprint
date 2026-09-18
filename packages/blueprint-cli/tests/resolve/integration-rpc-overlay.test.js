/**
 * Golden file tests for blueprint-generate-rpc-overlay CLI.
 *
 * Copies harness contracts to a temp directory, runs the overlay generator,
 * and compares the generated overlay YAML against committed goldens in the harness.
 *
 * Contract inputs:  packages/blueprint-harness/contracts/
 * Golden outputs:   packages/blueprint-harness/generated/overlays/
 *
 * To regenerate golden outputs:
 *   node packages/blueprint-cli/scripts/generate-rpc-overlay.js \
 *     --spec=packages/blueprint-harness/contracts
 *   cp packages/blueprint-harness/contracts/overlays/intake-rpc.yaml \
 *     packages/blueprint-harness/generated/overlays/intake-rpc.yaml
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { contractsDir, overlaysDir } from '../paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '../../scripts/generate-rpc-overlay.js');
const INPUTS = contractsDir;
const GOLDEN = overlaysDir;

const GOLDEN_FILES = [
  'intake-rpc.yaml',
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
        `${file} differs from golden — regenerate with generate-rpc-overlay.js against contracts/ and update generated/overlays/ if intentional`);
    });
  }
});
