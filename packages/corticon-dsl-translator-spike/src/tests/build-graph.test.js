import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProject } from '../corticon/project.js';
import { buildDependencyGraph, findCrossRulesheetAssembly, findCycles } from '../graph/build-graph.js';

test('builds every real fixture without error', () => {
  for (const dir of [
    'fixtures/dc-medicaid-chip',
    'fixtures/irr',
    'fixtures/mortgage',
    'fixtures/servicecallout',
    'fixtures/branch-reconstruction',
    'fixtures/all-patterns',
  ]) {
    assert.doesNotThrow(() => buildDependencyGraph(loadProject(dir)), `should build a graph for ${dir}`);
  }
});

test('confirms the real cross-rulesheet dependency: Set FPL from Household Size -> MAGI Eligibility Groups', () => {
  const graph = buildDependencyGraph(loadProject('fixtures/dc-medicaid-chip'));
  assert.ok(
    graph.edges.some((e) => e.from === 'Household.fpl' && e.to === 'Household.ActualPercentFPL'),
    'expected an edge from Household.fpl to Household.ActualPercentFPL'
  );
});

test('confirms the real cross-rulesheet Fact assembly: Person.MedicaidEligible written by Parse Cohorts.ers and Flatten.ers', () => {
  const graph = buildDependencyGraph(loadProject('fixtures/dc-medicaid-chip'));
  const assembly = findCrossRulesheetAssembly(graph);
  const medicaidEligible = assembly.find((a) => a.path === 'Person.MedicaidEligible');
  assert.ok(medicaidEligible, 'expected Person.MedicaidEligible to be flagged as cross-rulesheet assembly');
  assert.ok(medicaidEligible.rulesheets.some((r) => r.includes('Flatten')));
  assert.ok(medicaidEligible.rulesheets.some((r) => r.includes('Parse Cohorts')));
});

test('finds a genuine cycle in IRR: Investment.irr depends on itself across passes', () => {
  const graph = buildDependencyGraph(loadProject('fixtures/irr'));
  const cycles = findCycles(graph);
  assert.ok(
    cycles.some((c) => c.includes('Investment.irr')),
    'expected a structural self-loop on Investment.irr, confirmed real (Investment.irr = Investment.irr + 0.01)'
  );
});

test('DC Medicaid/CHIP has no genuine Decision-9-style cycle, despite a structural self-loop', () => {
  // Person.outputCoverage1 does show up as a structural self-loop (Flatten.ers checks
  // `outputCoverage1.contains(...)` in one rule's condition, then sets it in the
  // action) -- but this is an ordinary decision-table alternative row, not a real
  // cycle: it's not inside an `iterative="true"` Ruleflow node, unlike IRR's. This
  // test exists to document that distinction, not to assert findCycles() returns
  // zero results -- see the comment on findCycles in build-graph.js for why a raw
  // structural cycle isn't automatically a Decision 9 cycle.
  const graph = buildDependencyGraph(loadProject('fixtures/dc-medicaid-chip'));
  const cycles = findCycles(graph);
  assert.deepEqual(
    cycles.map((c) => c[0]),
    ['Person.outputCoverage1'],
    'the one confirmed real structural self-loop, from a decision-table alternative row, not genuine iteration'
  );
});

test('finds a genuine null-check-masking self-loop in Mortgage, structurally identical to a cycle but a different pattern', () => {
  const graph = buildDependencyGraph(loadProject('fixtures/mortgage'));
  const cycles = findCycles(graph);
  const lateDaySumAttrs = ['late30DaysSum', 'late60DaysSum', 'late90DaysSum', 'late120DaysSum'];
  for (const attr of lateDaySumAttrs) {
    assert.ok(
      cycles.some((c) => c[0] === `LoanApplication.${attr}`),
      `expected a structural self-loop on LoanApplication.${attr} from the real null-check-masking pattern`
    );
  }
});

test('flags the real Household.PrimaryInsuredId write as entity-creation-tainted, but not Person.age in the same rulesheet', () => {
  const graph = buildDependencyGraph(loadProject('fixtures/dc-medicaid-chip'));
  const householdWriters = graph.writes.get('Household.PrimaryInsuredId') ?? [];
  assert.ok(householdWriters.some((w) => w.isEntityCreation), 'Household.PrimaryInsuredId is set inside the real Household.newUnique[...] action');
  const ageWriters = graph.writes.get('Person.age') ?? [];
  assert.ok(ageWriters.length > 0 && ageWriters.every((w) => !w.isEntityCreation), 'Person.age is an ordinary date-arithmetic assignment, not entity creation');
});

test('a self-referencing assignment produces a self-loop edge, not a skipped/degenerate one', () => {
  const graph = buildDependencyGraph(loadProject('fixtures/irr'));
  const selfLoopEdges = graph.edges.filter((e) => e.from === e.to);
  assert.ok(selfLoopEdges.length > 0, 'self-loop edges must be recorded, not filtered out, for cycle detection to work at all');
});
