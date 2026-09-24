/**
 * Golden file test for blueprint-build-explorer CLI.
 *
 * Runs the full build-explorer pipeline against the harness and compares
 * every generated HTML file against committed golden output in the harness.
 * A failure here means a template or rendering change affected output —
 * rebuild the harness if intentional.
 *
 * Config inputs:   packages/blueprint-harness/explorer/
 * Resolved inputs: packages/blueprint-harness/generated/resolved/
 * Client inputs:   packages/blueprint-harness/generated/clients/
 * Golden outputs:  packages/blueprint-harness/generated/explorer/
 *
 * To regenerate golden outputs:
 *   node packages/blueprint-cli/scripts/build-explorer.js \
 *     --spec=packages/blueprint-harness/generated/resolved \
 *     --out=packages/blueprint-harness/generated/explorer \
 *     --config=packages/blueprint-harness/explorer \
 *     --clients=packages/blueprint-harness/generated/clients
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { readFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { resolvedDir, clientsDir, harnessAuthoredDir, explorerDir } from '../../paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '../../../scripts/build-explorer.js');

const tmpDir = mkdtempSync(join(tmpdir(), 'build-explorer-'));

describe('build-explorer', () => {
  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('all output pages match harness reference', () => {
    execFileSync(process.execPath, [
      SCRIPT,
      `--spec=${resolvedDir}`,
      `--out=${tmpDir}`,
      `--config=${harnessAuthoredDir}`,
      `--clients=${clientsDir}`,
    ], { stdio: 'inherit' });

    function walkAndCompare(dir) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walkAndCompare(fullPath);
        } else if (entry.name.endsWith('.html')) {
          const rel = fullPath.slice(explorerDir.length + 1);
          const actual   = readFileSync(join(tmpDir, rel), 'utf8');
          const expected = readFileSync(fullPath, 'utf8');
          assert.strictEqual(actual, expected, `${rel} differs from harness reference`);
        }
      }
    }

    walkAndCompare(explorerDir);
  });
});
