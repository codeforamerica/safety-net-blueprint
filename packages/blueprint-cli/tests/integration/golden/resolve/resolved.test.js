/**
 * Golden file tests for blueprint-resolve CLI — standard resolution.
 *
 * Runs resolve against the shared harness contracts and compares the
 * resolved output YAML against committed golden files in the harness.
 *
 * Shared inputs:  packages/blueprint-harness/contracts/
 * Golden outputs: packages/blueprint-harness/generated/resolved/
 *
 * To regenerate golden outputs:
 *   node packages/blueprint-cli/scripts/resolve.js \
 *     --spec=packages/blueprint-harness/contracts \
 *     --overlay=packages/blueprint-harness/contracts/overlays \
 *     --out=packages/blueprint-harness/generated/resolved
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { contractsDir, resolvedDir } from '../paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '../../scripts/resolve.js');
const INPUTS = contractsDir;
const GOLDENS = resolvedDir;
const projectRoot = join(__dirname, '../../..');

const GOLDEN_FILES = [
  'domains/intake/intake-openapi.yaml',
  'domains/eligibility/eligibility-openapi.yaml',
  'domains/intake/intake-state-machine.yaml',
  'base/schemas/enums.yaml',
];

describe('resolve golden — resolved', () => {
  let outDir;

  before(() => {
    outDir = mkdtempSync(join(tmpdir(), 'snb-resolve-golden-'));
    const result = spawnSync(
      process.execPath,
      [
        SCRIPT,
        `--spec=${INPUTS}`,
        `--overlay=${join(INPUTS, 'overlays')}`,
        `--out=${outDir}`,
      ],
      { cwd: projectRoot, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `resolve failed:\n${result.stderr}`);
  });

  after(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  for (const file of GOLDEN_FILES) {
    it(`${file} matches golden`, () => {
      const actual = readFileSync(join(outDir, file), 'utf8');
      const golden = readFileSync(join(GOLDENS, file), 'utf8');
      assert.strictEqual(actual, golden,
        `${file} differs from golden — regenerate with resolve.js against contracts/ and update generated/resolved/ if intentional`);
    });
  }
});
