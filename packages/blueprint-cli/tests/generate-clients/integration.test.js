/**
 * Golden file tests for TypeScript client generation.
 *
 * Resolves the shared fixture specs (compiling rules to a graph), then generates
 * TypeScript clients and compares against committed golden output files.
 * Fixture inputs:  tests/fixtures/
 * Golden outputs:  tests/generate-clients/golden/
 *
 * To regenerate golden outputs:
 *   node scripts/resolve.js \
 *     --spec=tests/fixtures \
 *     --overlay=tests/fixtures/overlays \
 *     --out=/tmp/snb-regen
 *   node scripts/generate-ts-clients.js \
 *     --spec=/tmp/snb-regen \
 *     --out=tests/generate-clients/golden
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sharedFixtures = join(__dirname, '../fixtures');
const golden = join(__dirname, 'golden');
const resolveScript = join(__dirname, '../../scripts/resolve.js');
const clientScript = join(__dirname, '../../scripts/generate-ts-clients.js');
const projectRoot = join(__dirname, '../../..');

const GOLDEN_FILES = [
  'alerts/sdk.gen.ts',
  'alerts/types.gen.ts',  // includes NoticeCategory named enum const (from external $defs)
  'alerts/zod.gen.ts',    // reviewer field patched with .nullable()
  'alerts/index.ts',
  'alerts/annotations.ts',      // generated from alerts-annotations.yaml
  'alerts/rules.ts',            // generated from alerts-graph.yaml (compiled by resolve from alerts-rules.yaml)
  'alerts/rules-types.gen.ts',  // domain-specific input/result types using FactNode<T>
];

describe('generate-clients golden', () => {
  let resolvedDir;
  let outDir;

  before(() => {
    // Step 1: Resolve shared fixtures — this compiles alerts-rules.yaml → alerts-graph.yaml
    // and applies the state overlay (enum source, x-relationship expand, RPC endpoints, etc.)
    resolvedDir = mkdtempSync(join(tmpdir(), 'snb-clients-resolved-'));
    const resolveResult = spawnSync(process.execPath, [
      resolveScript,
      `--spec=${sharedFixtures}`,
      `--overlay=${join(sharedFixtures, 'overlays')}`,
      `--out=${resolvedDir}`,
    ], { cwd: projectRoot, encoding: 'utf8' });
    assert.equal(resolveResult.status, 0, `Resolve failed:\n${resolveResult.stderr}`);

    // Step 2: Generate TypeScript clients from the resolved output
    outDir = mkdtempSync(join(tmpdir(), 'snb-clients-golden-'));
    const genResult = spawnSync(process.execPath, [
      clientScript,
      `--spec=${resolvedDir}`,
      `--out=${outDir}`,
    ], { cwd: projectRoot, encoding: 'utf8' });
    assert.equal(genResult.status, 0, `Client generation failed:\n${genResult.stderr}`);
  });

  after(() => {
    rmSync(resolvedDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });

  for (const file of GOLDEN_FILES) {
    it(`${file} matches golden`, () => {
      const actual = readFileSync(join(outDir, file), 'utf8');
      const goldenContent = readFileSync(join(golden, file), 'utf8');
      assert.strictEqual(actual, goldenContent,
        `${file} differs from golden — run \`npm run test:goldens-regenerate\` if intentional`);
    });
  }
});
