/**
 * Golden file tests for blueprint-export-schemas CLI.
 *
 * Runs the export-schemas script against the harness resolved specs and
 * compares every generated JSON Schema file against committed golden outputs
 * in the harness.
 *
 * Resolved inputs:  packages/blueprint-harness/generated/resolved/
 * Golden outputs:   packages/blueprint-harness/generated/schemas/
 *
 * To regenerate golden outputs:
 *   node packages/blueprint-cli/scripts/export-schemas.js \
 *     --spec=packages/blueprint-harness/generated/resolved \
 *     --out=packages/blueprint-harness/generated/schemas
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '../../scripts/export-schemas.js');
const HARNESS = join(__dirname, '../../../blueprint-harness');
const INPUTS = join(HARNESS, 'generated/resolved');
const GOLDENS = join(HARNESS, 'generated/schemas');
const projectRoot = join(__dirname, '../../..');

const GOLDEN_FILES = [
  'intake/Application.json',
  'intake/ApplicationWritable.json',
  'eligibility/Determination.json',
  'eligibility/DeterminationWritable.json',
];

describe('export-schemas golden', () => {
  let outDir;

  before(() => {
    outDir = mkdtempSync(join(tmpdir(), 'snb-export-schemas-golden-'));
    const result = spawnSync(process.execPath, [SCRIPT, `--spec=${INPUTS}`, `--out=${outDir}`], {
      cwd: projectRoot,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `export-schemas failed:\n${result.stderr}`);
  });

  after(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  for (const file of GOLDEN_FILES) {
    it(`${file} matches golden`, () => {
      const actual = readFileSync(join(outDir, file), 'utf8');
      const golden = readFileSync(join(GOLDENS, file), 'utf8');
      assert.strictEqual(actual, golden,
        `${file} differs from golden — regenerate with export-schemas.js against generated/resolved/ and update generated/schemas/ if intentional`);
    });
  }
});
