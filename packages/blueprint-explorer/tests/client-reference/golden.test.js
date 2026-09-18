/**
 * Golden file tests for client-reference HTML generation.
 *
 * Runs client-reference.js against the shared harness generated clients and
 * compares each output file against committed goldens. A failure means the
 * rendering changed — either update the goldens if the change was intentional,
 * or investigate the regression.
 *
 * Clients:      packages/blueprint-harness/generated/clients/
 * Resolved:     packages/blueprint-harness/generated/resolved/
 * Golden outputs: tests/client-reference/goldens/
 *
 * To regenerate golden outputs, run:
 *   node src/client-reference.js \
 *     --clients=../../blueprint-harness/generated/clients \
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
import { resolvedDir, clientsDir, explorerConfigPath } from '../paths.js';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const goldenDir  = join(__dirname, 'goldens');
const scriptPath = join(__dirname, '../../src/client-reference.js');

const tmpDir = mkdtempSync(join(tmpdir(), 'client-reference-golden-'));

describe('client-reference golden', () => {
  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('all output pages match goldens', () => {
    writeFileSync(join(tmpDir, 'config.yaml'), readFileSync(explorerConfigPath));

    execFileSync(process.execPath, [
      scriptPath,
      `--clients=${clientsDir}`,
      `--content=${tmpDir}`,
      `--resolved=${resolvedDir}`,
    ]);

    for (const file of readdirSync(goldenDir).filter(f => f.endsWith('.html'))) {
      const html   = readFileSync(join(tmpDir, 'client-reference', file), 'utf8');
      const golden = readFileSync(join(goldenDir, file), 'utf8');
      assert.strictEqual(html, golden,
        `client-reference/${file} differs from golden — regenerate if the change was intentional`);
    }
  });
});
