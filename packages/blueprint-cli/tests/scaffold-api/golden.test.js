/**
 * Golden file tests for blueprint-scaffold-api CLI.
 *
 * Runs the scaffold-api script with fixture arguments and compares the
 * generated OpenAPI spec against the committed golden output.
 *
 * Golden outputs: tests/scaffold-api/golden/
 *
 * To regenerate golden outputs:
 *   node scripts/scaffold-api.js \
 *     --name notifications --resource Notification \
 *     --out tests/scaffold-api/golden
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '../../scripts/scaffold-api.js');
const OUTPUTS = join(__dirname, 'golden');

const GOLDEN_FILES = [
  'notifications-openapi.yaml',
];

describe('scaffold-api golden', () => {
  let outDir;

  before(() => {
    outDir = mkdtempSync(join(tmpdir(), 'snb-scaffold-api-golden-'));
    const result = spawnSync(
      process.execPath,
      [SCRIPT, '--name', 'notifications', '--resource', 'Notification', '--out', outDir],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `scaffold-api failed:\n${result.stderr}`);
  });

  after(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  for (const file of GOLDEN_FILES) {
    it(`${file} matches golden`, () => {
      const actual = readFileSync(join(outDir, file), 'utf8');
      const golden = readFileSync(join(OUTPUTS, file), 'utf8');
      assert.strictEqual(actual, golden,
        `${file} differs from golden — run \`npm run test:goldens-regenerate\` if intentional`);
    });
  }
});
