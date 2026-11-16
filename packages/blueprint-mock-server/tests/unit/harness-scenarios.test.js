/**
 * Every Arazzo scenario in the harness passes against a fresh mock.
 *
 * The scenarios are found by their contract type in the harness's bundled
 * contract set, not by where they sit, and each runs against its own mock so
 * one cannot depend on what another left behind. A document that others name
 * as a source of type arazzo holds workflows they run, and runs inside them,
 * not on its own.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createMockServer, runScenario, operationIndex, controlOperations } from '../../src/server.js';
import { extract } from '@codeforamerica/blueprint-core/browser';

const contracts = JSON.parse(readFileSync(fileURLToPath(new URL('../../../blueprint-harness/generated/mock/contracts.json', import.meta.url)), 'utf8'));
const docs = extract(contracts, 'docs');
const arazzo = docs.filter((doc) => doc.type === 'arazzo');
const fileName = (path) => String(path).split('/').pop();
const runIn = new Set(arazzo.flatMap((doc) => (doc.content.sourceDescriptions ?? [])
  .filter((source) => source.type === 'arazzo').map((source) => fileName(source.url))));
const scenarios = arazzo.filter((doc) => !runIn.has(fileName(doc.relativePath)));

// A scenario whose workflows say which branch they're on (`x-branch`) runs
// every one that does, both the main path and the other situations: one that
// opens the others, run as their first step, is walked as part of the main path too.
const branchedWorkflows = (doc) => {
  const branched = (doc.content.workflows ?? []).filter((workflow) => workflow['x-branch']).map((workflow) => workflow.workflowId);
  return branched.length > 0 ? branched : undefined;
};

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
      results = await runScenario(scenario.content, { fetch: mock.fetch, operations, WebSocket: mock.WebSocket, documents: arazzo, workflows: branchedWorkflows(scenario) });
    } finally {
      console.log = log; console.warn = warn;
    }
    for (const workflow of results) {
      const failed = workflow.steps.find((step) => !step.passed);
      assert.ok(workflow.passed, failed
        ? `${workflow.workflowId}: step ${failed.stepId} failed — ${failed.checks.filter((c) => !c.passed).map((c) => c.condition).join('; ')} (got ${failed.response
          ? `${failed.response.status} ${JSON.stringify(failed.response.body).slice(0, 200)}`
          : JSON.stringify(failed.message?.payload ?? null).slice(0, 300)})`
        : `${workflow.workflowId} failed`);
    }
  });
}
