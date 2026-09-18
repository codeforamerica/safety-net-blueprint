import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, readdirSync, cpSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { resolvedDir, harnessAuthoredDir, explorerDir } from '../paths.js';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const require     = createRequire(import.meta.url);
const explorerPkg = dirname(require.resolve('@codeforamerica/blueprint-explorer/package.json'));
const seqSrcDir   = join(explorerPkg, 'src', 'sequence-diagrams');
const refDir      = join(explorerDir, 'sequence-diagrams');

const tmpDir = mkdtempSync(join(tmpdir(), 'sequence-diagrams-'));

describe('sequence-diagrams', () => {
  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('all output pages match harness reference', () => {
    writeFileSync(join(tmpDir, 'config.yaml'), readFileSync(join(harnessAuthoredDir, 'config.yaml')));
    const seqConfigDir = join(tmpDir, 'sequence-diagrams', 'config');
    cpSync(join(harnessAuthoredDir, 'sequence-diagrams', 'config'), seqConfigDir, { recursive: true });
    const seqOutDir = join(tmpDir, 'sequence-diagrams');
    mkdirSync(seqOutDir, { recursive: true });

    execFileSync(process.execPath, [
      join(seqSrcDir, 'validate-config.js'),
      `--config-dir=${seqConfigDir}`,
      `--resolved=${resolvedDir}`,
    ], { stdio: 'inherit' });

    execFileSync(process.execPath, [
      join(seqSrcDir, 'render-action-flow.js'),
      seqOutDir,
      `--config-dir=${seqConfigDir}`,
      `--content=${tmpDir}`,
      `--resolved=${resolvedDir}`,
    ], { stdio: 'inherit' });

    execFileSync(process.execPath, [
      join(seqSrcDir, 'build-phases-html.js'),
      seqOutDir,
      seqOutDir,
      `--config-dir=${seqConfigDir}`,
      `--content=${tmpDir}`,
      `--resolved=${resolvedDir}`,
    ], { stdio: 'inherit' });

    for (const file of readdirSync(refDir).filter(f => f.endsWith('.html'))) {
      const actual   = readFileSync(join(seqOutDir, file), 'utf8');
      const expected = readFileSync(join(refDir, file), 'utf8');
      assert.strictEqual(actual, expected, `sequence-diagrams/${file} differs from harness reference`);
    }
  });
});
