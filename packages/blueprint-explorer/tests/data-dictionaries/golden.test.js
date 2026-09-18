/**
 * Golden file tests for data-dictionary HTML generation.
 *
 * Generates field inventories from the shared harness resolved contracts, then
 * runs the data-dictionaries build script and compares each output file against
 * committed golden files. A failure here means the rendering changed — either
 * update the goldens if the change was intentional, or investigate the regression.
 *
 * Resolved contracts: packages/blueprint-harness/generated/resolved/
 * Golden outputs:     tests/data-dictionaries/goldens/
 *
 * To regenerate the golden outputs, run:
 *   node src/data-dictionaries/generate-field-inventory.mjs \
 *     --spec=../../blueprint-harness/generated/resolved \
 *     --out=tests/data-dictionaries/goldens/data-dictionaries
 *   node src/data-dictionaries/build.js \
 *     --content=tests/data-dictionaries/goldens \
 *     --resolved=../../blueprint-harness/generated/resolved
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { resolvedDir, explorerConfigPath } from '../paths.js';

const __dirname       = dirname(fileURLToPath(import.meta.url));
const goldensDir      = join(__dirname, 'goldens');
const buildScript     = join(__dirname, '../../src/data-dictionaries/build.js');
const inventoryScript = join(__dirname, '../../src/data-dictionaries/generate-field-inventory.mjs');

const tmpDir = mkdtempSync(join(tmpdir(), 'data-dict-golden-'));

describe('data-dictionaries golden', () => {
  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('all output pages match goldens', () => {
    writeFileSync(join(tmpDir, 'config.yaml'), readFileSync(explorerConfigPath));
    const ddDir = join(tmpDir, 'data-dictionaries');
    mkdirSync(ddDir, { recursive: true });

    // Generate field inventories from harness resolved contracts.
    execFileSync(process.execPath, [
      inventoryScript,
      `--spec=${resolvedDir}`,
      `--out=${ddDir}`,
    ]);

    // Build HTML from the generated inventories.
    execFileSync(process.execPath, [
      buildScript,
      `--content=${tmpDir}`,
      `--resolved=${resolvedDir}`,
    ]);

    for (const file of readdirSync(goldensDir).filter(f => f.endsWith('.html'))) {
      const html   = readFileSync(join(ddDir, file), 'utf8');
      const golden = readFileSync(join(goldensDir, file), 'utf8');
      assert.strictEqual(html, golden,
        `data-dictionaries/${file} differs from golden — regenerate if the change was intentional`);
    }
  });
});
