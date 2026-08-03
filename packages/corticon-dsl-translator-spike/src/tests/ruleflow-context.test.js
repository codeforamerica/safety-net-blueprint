import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProject } from '../ingest/project.js';
import { resolveRuleflowContext } from '../classify/ruleflow-context.js';

test('IRR: rulesheets inside the iterative loop are marked iterative, the setup step is not', () => {
  const ctx = resolveRuleflowContext(loadProject('fixtures/irr'));
  assert.deepEqual(ctx.roots, ['top level flow.erf']);
  assert.equal(ctx.perRulesheet.get('evaluate npv.ers').iterative, true);
  assert.equal(ctx.perRulesheet.get('solve each cashflow.ers').iterative, true);
  assert.equal(ctx.perRulesheet.get('initial values.ers').iterative, false, 'invoked directly, non-iteratively');
  assert.deepEqual(ctx.unreachable, []);
  assert.deepEqual(ctx.multiInvoked, []);
});

test('DC Medicaid/CHIP: resolves real cross-directory invokes references (both.erf -> subdirectory ruleflows)', () => {
  const ctx = resolveRuleflowContext(loadProject('fixtures/dc-medicaid-chip'));
  assert.deepEqual(ctx.roots, ['both.erf']);
  assert.equal(ctx.perRulesheet.get('Medicaid Applicant\\Citizenship requirements.ers').invocationCount, 1);
  assert.equal(ctx.perRulesheet.get('CHIP rules\\Calculate_premium.ers').invocationCount, 1);
  assert.ok(
    [...ctx.perRulesheet.values()].every((v) => v.iterative === false && v.branched === false),
    'confirms the real cascade uses plain sequencing, matching the domain-likelihood finding in Decision 9'
  );
});

test('DC Medicaid/CHIP: confirms a real unreachable rulesheet -- Non-MAGI Eligibility Groups.ers is never invoked by any real Ruleflow', () => {
  // Confirmed by direct inspection: no .erf file in the real project references this
  // rulesheet by name at all -- not a resolution bug, genuinely dead content. This
  // upgrades "unreachable rulesheet" from a defensive-only check to a real, observed
  // pattern (see issue #388).
  const ctx = resolveRuleflowContext(loadProject('fixtures/dc-medicaid-chip'));
  assert.deepEqual(ctx.unreachable, ['Medicaid Applicant\\Non-MAGI Eligibility Groups.ers']);
});

test('all-patterns: a rulesheet reached through both an iterative node and a BranchContainer carries both flags', () => {
  const ctx = resolveRuleflowContext(loadProject('fixtures/all-patterns'));
  assert.deepEqual(ctx.roots, ['top-level-flow.erf']);
  // ProgramAEligibility/BEligibility.ers sit inside program-eligibility-loop.erf's
  // BranchContainer, itself invoked from an iterative ActivityNode -- both signals apply.
  assert.deepEqual(ctx.perRulesheet.get('ProgramAEligibility.ers'), { iterative: true, branched: true, invocationCount: 1 });
  assert.deepEqual(ctx.perRulesheet.get('ProgramBEligibility.ers'), { iterative: true, branched: true, invocationCount: 1 });
  // AdjustBenefit.ers sits inside benefit-loop.erf, invoked from an iterative
  // ActivityNode but never from a BranchContainer.
  assert.deepEqual(ctx.perRulesheet.get('AdjustBenefit.ers'), { iterative: true, branched: false, invocationCount: 1 });
  // DisabilityBranchA/B.ers sit inside a non-iterative BranchContainer.
  assert.deepEqual(ctx.perRulesheet.get('DisabilityBranchA.ers'), { iterative: false, branched: true, invocationCount: 1 });
  assert.deepEqual(ctx.perRulesheet.get('DisabilityBranchB.ers'), { iterative: false, branched: true, invocationCount: 1 });
  // CreateHouseholds.ers is a plain sequential step -- neither flag applies.
  assert.deepEqual(ctx.perRulesheet.get('CreateHouseholds.ers'), { iterative: false, branched: false, invocationCount: 1 });
  assert.deepEqual(ctx.unreachable, []);
  assert.deepEqual(ctx.multiInvoked, []);
});

test('flags a rulesheet invoked from two disagreeing contexts -- not observed in any real fixture, exercised with minimal synthetic data', () => {
  // Two ActivityNodes in one ruleflow invoke the same rulesheet: one plain, one
  // iterative. No real project we have does this; this proves the defensive check
  // itself works, per issue #388's "Additional defensive checks" section.
  const project = {
    ruleflows: new Map([
      [
        'main.erf',
        {
          nodes: [
            { kind: 'ActivityNode', name: 'Plain', iterative: false, invokes: 'Shared.ers#//@ruleset' },
            { kind: 'ActivityNode', name: 'Loop', iterative: true, invokes: 'Shared.ers#//@ruleset' },
          ],
        },
      ],
    ]),
    rulesheets: new Map([['Shared.ers', {}]]),
  };
  const ctx = resolveRuleflowContext(project);
  assert.equal(ctx.multiInvoked.length, 1);
  assert.equal(ctx.multiInvoked[0].rulesheet, 'Shared.ers');
  assert.equal(ctx.multiInvoked[0].contexts.length, 2);
  // Combined via OR for classification purposes, per the documented tradeoff.
  assert.deepEqual(ctx.perRulesheet.get('Shared.ers'), { iterative: true, branched: false, invocationCount: 2 });
});
