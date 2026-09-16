/**
 * Golden file tests for blueprint-resolve CLI — standard resolution.
 *
 * Runs resolve with an overlay (including config) and compares the
 * resolved output YAML against committed golden files.
 *
 * Shared inputs:  tests/fixtures/
 * Golden outputs: tests/resolve/golden/resolved/
 *
 * To regenerate golden outputs:
 *   node scripts/resolve.js \
 *     --spec=tests/fixtures \
 *     --overlay=tests/fixtures/overlays \
 *     --out=tests/resolve/golden/resolved
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '../../scripts/resolve.js');
const INPUTS = join(__dirname, '../fixtures');
const GOLDENS = join(__dirname, 'golden/resolved');
const projectRoot = join(__dirname, '../../..');

const GOLDEN_FILES = [
  'alerts-openapi.yaml',
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
        `${file} differs from golden — run \`npm run test:goldens-regenerate\` if intentional`);
    });
  }
});
