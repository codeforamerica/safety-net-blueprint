/**
 * Every Arazzo scenario in the harness passes against a fresh mock.
 *
 * The scenarios are found by their contract type in the harness's bundled
 * contract set, not by where they sit, and each runs against its own mock so
 * one cannot depend on what another left behind.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createMockServer, runScenario, operationIndex, controlOperations } from '../../src/browser.js';
import { extract } from '@codeforamerica/blueprint-core/browser';

const contracts = JSON.parse(readFileSync(fileURLToPath(new URL('../../../blueprint-harness/generated/mock/contracts.json', import.meta.url)), 'utf8'));
const docs = extract(contracts, 'docs');
const scenarios = docs.filter((doc) => doc.type === 'arazzo');

test('the harness has scenarios to run', () => {
  assert.ok(scenarios.length > 0);
});

for (const scenario of scenarios) {
  test(`scenario ${scenario.relativePath} passes`, async () => {
    const log = console.log; const warn = console.warn;
    console.log = () => {}; console.warn = () => {};
    let results;
    try {
      const mock = await createMockServer({ contracts, seed: true });
      const operations = new Map([...operationIndex(docs), ...controlOperations(mock)]);
      results = await runScenario(scenario.content, { fetch: mock.fetch, operations });
    } finally {
      console.log = log; console.warn = warn;
    }
    for (const workflow of results) {
      const failed = workflow.steps.find((step) => !step.passed);
      assert.ok(workflow.passed, failed
        ? `${workflow.workflowId}: step ${failed.stepId} failed — ${failed.checks.filter((c) => !c.passed).map((c) => c.condition).join('; ')} (got ${failed.response.status} ${JSON.stringify(failed.response.body).slice(0, 200)})`
        : `${workflow.workflowId} failed`);
    }
  });
}
