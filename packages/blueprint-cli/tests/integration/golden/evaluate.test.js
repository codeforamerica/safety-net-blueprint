/**
 * Golden file test for blueprint-evaluate CLI — batch mode output.
 *
 * Runs evaluate in batch mode against the harness rules examples file and
 * compares stdout against the committed golden file. A failure here means
 * evaluation output changed — regenerate if intentional.
 *
 * Contract inputs: packages/blueprint-harness/contracts/domains/eligibility/
 * Golden output:   packages/blueprint-harness/generated/evaluate/
 *
 * To regenerate golden output:
 *   node packages/blueprint-cli/scripts/evaluate.js \
 *     --spec=packages/blueprint-harness/contracts/domains/eligibility/eligibility-rules-examples.yaml \
 *     > packages/blueprint-harness/generated/evaluate/eligibility-rules-examples-batch.json
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { contractsDir, evaluateDir } from '../../paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '../../../scripts/evaluate.js');
const EXAMPLES = join(contractsDir, 'domains/eligibility', 'eligibility-rules-examples.yaml');

describe('blueprint-evaluate CLI — batch golden', () => {
  it('batch output matches golden', () => {
    const { status, stdout, stderr } = spawnSync(process.execPath, [SCRIPT, `--spec=${EXAMPLES}`], { encoding: 'utf8' });
    assert.equal(status, 0, `script failed:\n${stderr}`);
    const golden = readFileSync(join(evaluateDir, 'eligibility-rules-examples-batch.json'), 'utf8');
    assert.strictEqual(stdout, golden,
      'output differs from golden — regenerate with evaluate.js against the rules examples file and update generated/evaluate/ if intentional');
  });
});
