/**
 * Golden file tests for TypeScript client generation.
 *
 * Resolves the harness contracts (compiling rules to a graph, injecting RPC
 * endpoints, etc.), then generates TypeScript clients and compares against
 * committed golden output files in the harness.
 *
 * Contract inputs:  packages/blueprint-harness/contracts/
 * Golden outputs:   packages/blueprint-harness/generated/clients/
 *
 * To regenerate golden outputs:
 *   node packages/blueprint-cli/scripts/generate-ts-clients.js \
 *     --spec=packages/blueprint-harness/generated/resolved \
 *     --out=packages/blueprint-harness/generated/clients
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { contractsDir, clientsDir } from '../paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contracts = contractsDir;
const golden = clientsDir;
const resolveScript = join(__dirname, '../../scripts/resolve.js');
const clientScript = join(__dirname, '../../scripts/generate-ts-clients.js');
const projectRoot = join(__dirname, '../../..');

const GOLDEN_FILES = [
  'eligibility/sdk.gen.ts',
  'eligibility/types.gen.ts',
  'eligibility/zod.gen.ts',
  'eligibility/index.ts',
  'eligibility/annotations.ts',
  'eligibility/rules.ts',
  'eligibility/rules-types.gen.ts',
  'intake/sdk.gen.ts',
  'intake/types.gen.ts',
  'intake/zod.gen.ts',
  'intake/index.ts',
  'intake/annotations.ts',
];

describe('generate-clients golden', () => {
  let resolvedDir;
  let outDir;

  before(() => {
    // Step 1: Resolve harness contracts
    resolvedDir = mkdtempSync(join(tmpdir(), 'snb-clients-resolved-'));
    const resolveResult = spawnSync(process.execPath, [
      resolveScript,
      `--spec=${contracts}`,
      `--overlay=${join(contracts, 'overlays')}`,
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
        `${file} differs from golden — regenerate with generate-ts-clients.js against generated/resolved/ and update generated/clients/ if intentional`);
    });
  }
});
