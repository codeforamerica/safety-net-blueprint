import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProject } from '../ingest/project.js';
import { buildDependencyGraph } from '../graph/build-graph.js';
import { resolveRuleflowContext } from '../classify/ruleflow-context.js';
import { classifySelfLoops, classifyMultiHopCycles } from '../classify/cycle-classifier.js';

test('classifies IRR\'s real self-loop as a genuine cycle -- inside the iterative loop', () => {
  const project = loadProject('fixtures/irr');
  const graph = buildDependencyGraph(project);
  const ctx = resolveRuleflowContext(project);
  const results = classifySelfLoops(project, graph, ctx);
  assert.ok(results.length > 0);
  assert.ok(results.every((r) => r.path === 'Investment.irr' && r.classification === 'genuine-cycle'));
});

test('classifies IRR\'s real multi-hop cycle (npv -> irr -> portion -> npv) as a genuine cycle, spanning two rulesheets', () => {
  // Confirmed real: `evaluate npv.ers` computes Investment.npv from Cashflow.portion
  // and updates Investment.irr from Investment.npv; `solve each cashflow.ers`
  // discounts each Cashflow.portion by the current Investment.irr guess. Both
  // rulesheets are reached from the same iterative loop.
  const project = loadProject('fixtures/irr');
  const graph = buildDependencyGraph(project);
  const ctx = resolveRuleflowContext(project);
  const results = classifyMultiHopCycles(graph, ctx);
  assert.equal(results.length, 1);
  assert.deepEqual(results[0].path.sort(), ['Cashflow.portion', 'Investment.irr', 'Investment.npv']);
  assert.deepEqual(results[0].rulesheets.sort(), ['evaluate npv.ers', 'solve each cashflow.ers']);
  assert.equal(results[0].classification, 'genuine-cycle');
});

test('classifies DC Medicaid\'s two real self-loop-causing rules on the same path distinctly', () => {
  // Person.outputCoverage1 has TWO independent self-referencing rules within
  // Flatten.ers: one an explicit null-check (masking), one a content-check
  // (an ordinary decision-table alternative row) -- confirmed real, and only
  // fully visible once the method-term/action-scoping graph bugs were fixed.
  const project = loadProject('fixtures/dc-medicaid-chip');
  const graph = buildDependencyGraph(project);
  const ctx = resolveRuleflowContext(project);
  const results = classifySelfLoops(project, graph, ctx);
  assert.deepEqual(
    results.map((r) => r.classification).sort(),
    ['decision-table-alternative-row', 'null-check-masking']
  );
});

test('classifies Mortgage\'s real null-check-masking self-loops correctly', () => {
  const project = loadProject('fixtures/mortgage');
  const graph = buildDependencyGraph(project);
  const ctx = resolveRuleflowContext(project);
  const results = classifySelfLoops(project, graph, ctx);
  assert.equal(results.length, 4);
  assert.ok(results.every((r) => r.classification === 'null-check-masking'));
});

test('all-patterns: classifies the genuine cycle and the null-check masking self-loops distinctly', () => {
  const project = loadProject('fixtures/all-patterns');
  const graph = buildDependencyGraph(project);
  const ctx = resolveRuleflowContext(project);
  const results = classifySelfLoops(project, graph, ctx);
  const byPath = Object.fromEntries(results.map((r) => [r.path, r.classification]));
  assert.equal(byPath['Household.estimatedBenefit'], 'genuine-cycle');
  assert.equal(byPath['Applicant.reportedAssets'], 'null-check-masking');
});

test('flags a non-iterative multi-hop cycle as unclassified -- not observed in any real fixture, exercised with minimal synthetic data', () => {
  // No real or fixture project has a multi-node cycle outside an iterative
  // context; this proves the defensive fallback itself works rather than
  // silently mislabeling something we have no real evidence about as a
  // "genuine cycle."
  const graph = {
    nodes: new Set(['A', 'B']),
    edges: [
      { from: 'A', to: 'B', rulesheet: 'one.ers', ruleIndex: 0 },
      { from: 'B', to: 'A', rulesheet: 'two.ers', ruleIndex: 0 },
    ],
    writes: new Map(),
  };
  const ruleflowContext = { perRulesheet: new Map([['one.ers', { iterative: false }], ['two.ers', { iterative: false }]]) };
  const results = classifyMultiHopCycles(graph, ruleflowContext);
  assert.equal(results.length, 1);
  assert.equal(results[0].classification, 'unclassified-multi-hop-cycle');
});
