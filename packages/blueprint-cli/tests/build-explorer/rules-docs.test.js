import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { resolvedDir, explorerConfigPath, explorerDir } from '../paths.js';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const require     = createRequire(import.meta.url);
const explorerPkg = dirname(require.resolve('@codeforamerica/blueprint-explorer/package.json'));
const script      = join(explorerPkg, 'src', 'rules-docs', 'build.js');
const refDir      = join(explorerDir, 'rules-docs');

const tmpDir = mkdtempSync(join(tmpdir(), 'rules-docs-'));

describe('rules-docs', () => {
  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('all output pages match harness reference', () => {
    writeFileSync(join(tmpDir, 'config.yaml'), readFileSync(explorerConfigPath));

    execFileSync(process.execPath, [
      script,
      `--content=${tmpDir}`,
      `--resolved=${resolvedDir}`,
    ], { stdio: 'inherit' });

    for (const file of readdirSync(refDir).filter(f => f.endsWith('.html'))) {
      const actual   = readFileSync(join(tmpDir, 'rules-docs', file), 'utf8');
      const expected = readFileSync(join(refDir, file), 'utf8');
      assert.strictEqual(actual, expected, `rules-docs/${file} differs from harness reference`);
    }
  });
});
