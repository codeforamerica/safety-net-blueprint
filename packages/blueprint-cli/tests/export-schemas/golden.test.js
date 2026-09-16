/**
 * Golden file tests for blueprint-export-schemas CLI.
 *
 * Runs the export-schemas script against the shared fixture specs and
 * compares every generated JSON Schema file against committed golden outputs.
 *
 * Fixture inputs:  tests/fixtures/
 * Golden outputs:  tests/export-schemas/golden/
 *
 * To regenerate golden outputs:
 *   node scripts/export-schemas.js \
 *     --spec=tests/fixtures \
 *     --out=tests/export-schemas/golden
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
const INPUTS = join(__dirname, '../fixtures');
const GOLDENS = join(__dirname, 'golden');
const projectRoot = join(__dirname, '../../..');

const GOLDEN_FILES = [
  'alerts/Notice.json',
  'alerts/NoticeCreate.json',
  'alerts/NoticeList.json',
  'alerts/NoticeUpdate.json',
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
        `${file} differs from golden — run \`npm run test:goldens-regenerate\` if intentional`);
    });
  }
});
