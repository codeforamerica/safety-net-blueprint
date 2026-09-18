/**
 * Golden file tests for api-reference HTML generation.
 *
 * Runs the api-reference build script as a subprocess against the shared
 * harness resolved contracts and compares each output file against committed
 * golden files. A failure here means the rendering changed — either update
 * the goldens if the change was intentional, or investigate the regression.
 *
 * Resolved contracts: packages/blueprint-harness/generated/resolved/
 * Golden outputs:     tests/api-reference/goldens/
 *
 * To regenerate the golden outputs, run:
 *   node src/api-reference.js \
 *     --content=tests/fixtures \
 *     --resolved=../../blueprint-harness/generated/resolved
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { resolvedDir, explorerConfigPath } from '../paths.js';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const goldenDir  = join(__dirname, 'goldens');
const scriptPath = join(__dirname, '../../src/api-reference.js');

const tmpDir = mkdtempSync(join(tmpdir(), 'api-reference-golden-'));

describe('api-reference golden', () => {
  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('all output pages match goldens', () => {
    writeFileSync(join(tmpDir, 'config.yaml'), readFileSync(explorerConfigPath));

    execFileSync(process.execPath, [
      scriptPath,
      `--content=${tmpDir}`,
      `--resolved=${resolvedDir}`,
    ]);

    for (const file of readdirSync(goldenDir).filter(f => f.endsWith('.html'))) {
      const html   = readFileSync(join(tmpDir, 'api-reference', file), 'utf8');
      const golden = readFileSync(join(goldenDir, file), 'utf8');
      assert.strictEqual(html, golden,
        `api-reference/${file} differs from golden — regenerate if the change was intentional`);
    }
  });
});
