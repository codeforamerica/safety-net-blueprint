import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProject } from '../ingest/project.js';
import { buildDependencyGraph } from '../graph/build-graph.js';
import { classifyDecisionTableCombinatorics } from '../classify/decision-table-classifier.js';

test('classifies Mortgage\'s real Select_Credit.ers 3-row decision table converging on one write', () => {
  // Confirmed real: 3 rules (>= 3 liabilities AND a high-credit one; >= 3 liabilities
  // AND none high-credit; < 3 liabilities), each an independent alternative, all
  // writing loanapp.creditReqtMet -- no rule reads a path it also writes, so this is
  // not a self-loop, just ordinary decision-table combinatorics.
  const project = loadProject('fixtures/mortgage');
  const graph = buildDependencyGraph(project);
  const results = classifyDecisionTableCombinatorics(graph).filter((r) => r.rulesheet === 'Select_Credit.ers');
  assert.equal(results.length, 1);
  assert.equal(results[0].path, 'LoanApplication.creditReqtMet');
  assert.deepEqual(results[0].ruleIndices, [0, 1, 2]);
});

test('a path written by only one rule in its rulesheet is not flagged', () => {
  const graph = {
    writes: new Map([['Foo.bar', [{ rulesheet: 'one.ers', ruleIndex: 0, isEntityCreation: false }]]]),
  };
  assert.deepEqual(classifyDecisionTableCombinatorics(graph), []);
});

test('works against the JSON-reconstituted (plain-object) shape produced by graph-project.js --out, not just a live Map', () => {
  const graph = {
    writes: { 'Foo.bar': [{ rulesheet: 'one.ers', ruleIndex: 0 }, { rulesheet: 'one.ers', ruleIndex: 1 }] },
  };
  const results = classifyDecisionTableCombinatorics(graph);
  assert.equal(results.length, 1);
  assert.deepEqual(results[0].ruleIndices, [0, 1]);
});
