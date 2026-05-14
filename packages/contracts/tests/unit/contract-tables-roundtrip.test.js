/**
 * Round-trip test for contract-tables export/import scripts.
 * Exports a state machine to CSV, imports back into a copy of the original,
 * and asserts the parsed YAML is unchanged.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsRoot = join(__dirname, '../../');
const exportScript = join(contractsRoot, 'scripts/export-contract-tables.js');
const importScript = join(contractsRoot, 'scripts/import-contract-tables.js');

function run(scriptPath, args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: contractsRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`${scriptPath} failed:\n${result.stderr}\n${result.stdout}`);
  }
}

for (const smFile of ['workflow-state-machine.yaml', 'intake-state-machine.yaml']) {
  test(`round-trip export→import leaves ${smFile} unchanged`, () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ct-roundtrip-'));
    try {
      const tablesDir = join(tmp, 'tables');
      const contractsDir = join(tmp, 'contracts');
      mkdirSync(tablesDir);
      mkdirSync(contractsDir);

      const src = join(contractsRoot, smFile);
      const dst = join(contractsDir, smFile);
      copyFileSync(src, dst);

      run(exportScript, [`--spec=${src}`, `--out=${tablesDir}`]);
      run(importScript, [`--tables=${tablesDir}`, `--out=${contractsDir}`]);

      const original = yaml.load(readFileSync(src, 'utf8'));
      const roundTripped = yaml.load(readFileSync(dst, 'utf8'));

      assert.deepStrictEqual(roundTripped, original);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
}
