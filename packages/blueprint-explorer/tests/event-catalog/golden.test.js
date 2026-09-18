/**
 * Golden file tests for event-catalog HTML generation.
 *
 * Runs the event-catalog build script against the shared harness resolved
 * contracts and compares the output against a committed golden file. A failure
 * here means the rendering changed — either update the golden if the change
 * was intentional, or investigate the regression.
 *
 * Resolved contracts: packages/blueprint-harness/generated/resolved/
 * Golden output:      tests/event-catalog/goldens/index.html
 *
 * To regenerate the golden output, run:
 *   node src/event-catalog.js \
 *     --content=tests/fixtures \
 *     --resolved=../../blueprint-harness/generated/resolved
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { resolvedDir, explorerConfigPath } from '../paths.js';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const goldenFile = join(__dirname, 'goldens', 'index.html');
const scriptPath  = join(__dirname, '../../src/event-catalog.js');

const tmpDir = mkdtempSync(join(tmpdir(), 'event-catalog-golden-'));

describe('event-catalog golden', () => {
  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('index page matches golden', () => {
    writeFileSync(join(tmpDir, 'config.yaml'), readFileSync(explorerConfigPath));

    execFileSync(process.execPath, [
      scriptPath,
      `--content=${tmpDir}`,
      `--resolved=${resolvedDir}`,
    ]);

    const html   = readFileSync(join(tmpDir, 'event-catalog', 'index.html'), 'utf8');
    const golden = readFileSync(goldenFile, 'utf8');
    assert.strictEqual(html, golden,
      'event-catalog HTML differs from golden — regenerate if the change was intentional');
  });
});
