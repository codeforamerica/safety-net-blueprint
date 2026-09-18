import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { resolvedDir, explorerConfigPath, explorerDir } from '../paths.js';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const require     = createRequire(import.meta.url);
const explorerPkg = dirname(require.resolve('@codeforamerica/blueprint-explorer/package.json'));
const buildScript     = join(explorerPkg, 'src', 'data-dictionaries', 'build.js');
const inventoryScript = join(explorerPkg, 'src', 'data-dictionaries', 'generate-field-inventory.mjs');
const refDir          = join(explorerDir, 'data-dictionaries');

const tmpDir = mkdtempSync(join(tmpdir(), 'data-dictionaries-'));

describe('data-dictionaries', () => {
  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('all output pages match harness reference', () => {
    writeFileSync(join(tmpDir, 'config.yaml'), readFileSync(explorerConfigPath));
    const ddDir = join(tmpDir, 'data-dictionaries');
    mkdirSync(ddDir, { recursive: true });

    execFileSync(process.execPath, [
      inventoryScript,
      `--spec=${resolvedDir}`,
      `--out=${ddDir}`,
    ], { stdio: 'inherit' });

    execFileSync(process.execPath, [
      buildScript,
      `--content=${tmpDir}`,
      `--resolved=${resolvedDir}`,
    ], { stdio: 'inherit' });

    for (const file of readdirSync(refDir).filter(f => f.endsWith('.html'))) {
      const actual   = readFileSync(join(ddDir, file), 'utf8');
      const expected = readFileSync(join(refDir, file), 'utf8');
      assert.strictEqual(actual, expected, `data-dictionaries/${file} differs from harness reference`);
    }
  });
});
