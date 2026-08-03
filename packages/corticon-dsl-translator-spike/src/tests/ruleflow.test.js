import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRuleflow } from '../corticon/ruleflow.js';

test('confirms the real iterative="true" shape from the IRR fixture', () => {
  const { nodes } = parseRuleflow('fixtures/irr/top level flow.erf');
  const loopNode = nodes.find((n) => n.name === 'loop');
  assert.ok(loopNode, 'expected a node named "loop"');
  assert.equal(loopNode.kind, 'ActivityNode', 'iterative is a plain attribute, not a distinct node type');
  assert.equal(loopNode.iterative, true);
  assert.equal(loopNode.invokes, 'loop.erf#//@ruleflow');

  const initialValuesNode = nodes.find((n) => n.name === 'initial values');
  assert.equal(initialValuesNode.iterative, false, 'only the loop node is marked iterative');
});

test('extracts the confirmed real connectorList shape from the ServiceCallOut fixture', () => {
  const { nodes, connectors } = parseRuleflow('fixtures/servicecallout/Fetch.erf');
  assert.equal(nodes[0].invokes, '#//@ruleflow/@connectorList.0');
  assert.deepEqual(connectors.get('fetchURL'), {
    className: 'FetchServiceCallout.js',
    serviceName: 'fetchURL',
  });
});

test('extracts a BranchContainer condition and both branches from the original reconstruction', () => {
  const { nodes } = parseRuleflow('fixtures/branch-reconstruction/branch-example.erf');
  assert.equal(nodes.length, 1);
  const branch = nodes[0];
  assert.equal(branch.kind, 'BranchContainer');
  assert.equal(branch.condition.text, 'Employee.hasCertification');
  assert.equal(branch.branches.length, 2);
  assert.deepEqual(
    branch.branches.map((b) => b.targets.map((t) => t.name)),
    [['CertifiedTrack'], ['TraineeTrack']]
  );
});

test('captures every chained nextStep in a single branch, not just the first', () => {
  // Confirmed real in InsuranceRating.erf (5 chained nodes in one branch) and
  // reconstructed in this spike's own all-patterns fixture: a <branches> block
  // can hold more than one <nextStep>, and all of them must survive parsing.
  const { nodes } = parseRuleflow('fixtures/all-patterns/top-level-flow.erf');
  const disabilityBranch = nodes.find((n) => n.name === 'DisabilityBranch');
  assert.equal(disabilityBranch.kind, 'BranchContainer');
  assert.equal(disabilityBranch.branches.length, 1, 'one true-case branch, no false branch');
  assert.deepEqual(
    disabilityBranch.branches[0].targets.map((t) => t.name),
    ['DisabilityBranchA', 'DisabilityBranchB']
  );
  assert.deepEqual(
    disabilityBranch.branches[0].targets.map((t) => t.invokes),
    ['DisabilityBranchA.ers#//@ruleset', 'DisabilityBranchB.ers#//@ruleset']
  );
});

test('DC Medicaid/CHIP is a plain sequential cascade -- no Branch, no Iterative', () => {
  const { nodes } = parseRuleflow('fixtures/dc-medicaid-chip/both.erf');
  assert.equal(nodes.length, 2);
  assert.ok(
    nodes.every((n) => n.kind === 'ActivityNode' && n.iterative === false),
    'confirms the real cascade uses plain sequencing, matching the domain-likelihood finding in Decision 9'
  );
});
