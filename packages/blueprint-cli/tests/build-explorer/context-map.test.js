import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, cpSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { resolvedDir, harnessAuthoredDir, explorerDir } from '../paths.js';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const require     = createRequire(import.meta.url);
const explorerPkg = dirname(require.resolve('@codeforamerica/blueprint-explorer/package.json'));
const script      = join(explorerPkg, 'src', 'context-map', 'build.js');
const refDir      = join(explorerDir, 'context-map');

const tmpDir = mkdtempSync(join(tmpdir(), 'context-map-'));

describe('context-map', () => {
  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('all output pages match harness reference', () => {
    writeFileSync(join(tmpDir, 'config.yaml'), readFileSync(join(harnessAuthoredDir, 'config.yaml')));
    cpSync(join(harnessAuthoredDir, 'context-map', 'config'), join(tmpDir, 'context-map', 'config'), { recursive: true });

    execFileSync(process.execPath, [
      script,
      `--content=${tmpDir}`,
      `--resolved=${resolvedDir}`,
    ], { stdio: 'inherit' });

    for (const file of readdirSync(refDir).filter(f => f.endsWith('.html'))) {
      const actual   = readFileSync(join(tmpDir, 'context-map', file), 'utf8');
      const expected = readFileSync(join(refDir, file), 'utf8');
      assert.strictEqual(actual, expected, `context-map/${file} differs from harness reference`);
    }
  });
});
