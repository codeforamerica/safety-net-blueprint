/**
 * Golden file test for generate-postman-collection CLI.
 *
 * Runs the script against a minimal fixture spec and compares the output against
 * a committed golden file. A failure here means the Postman collection structure
 * changed — regenerate if intentional.
 *
 * Fixture inputs:  tests/fixtures/
 * Golden output:   tests/generate-postman-collection/golden/postman-collection.json
 *
 * To regenerate golden output:
 *   node scripts/generate-postman-collection.js \
 *     --spec=tests/fixtures \
 *     --out=tests/generate-postman-collection/golden/postman-collection.json
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '../../scripts/generate-postman-collection.js');
const INPUTS = join(__dirname, '../fixtures');
const GOLDEN = join(__dirname, 'golden/postman-collection.json');
const projectRoot = join(__dirname, '../../..');

// Strip _postman_id before comparing — it's a random UUID that changes every run
// when no existing collection is present to preserve it.
function normalize(json) {
  const obj = JSON.parse(json);
  if (obj.info) delete obj.info._postman_id;
  return JSON.stringify(obj, null, 2);
}

describe('generate-postman-collection golden', () => {
  let outDir;
  let outFile;

  before(() => {
    outDir = mkdtempSync(join(tmpdir(), 'snb-postman-golden-'));
    outFile = join(outDir, 'postman-collection.json');
    const result = spawnSync(
      process.execPath,
      [SCRIPT, `--spec=${INPUTS}`, `--out=${outFile}`],
      { cwd: projectRoot, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `generate-postman-collection failed:\n${result.stderr}`);
  });

  after(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('postman-collection.json matches golden', () => {
    const actual = normalize(readFileSync(outFile, 'utf8'));
    const golden = normalize(readFileSync(GOLDEN, 'utf8'));
    assert.strictEqual(actual, golden,
      'postman-collection.json differs from golden — regenerate with `npm run test:goldens-regenerate` if intentional');
  });
});
