import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProject } from '../sources/corticon/project.js';
import { resolveRuleflowContext } from '../sources/corticon/classify/ruleflow-context.js';
import { classifyCycles, classifyMultiHopCycles } from '../sources/corticon/classify/cycle-classifier.js';
import { classifyNullGuards } from '../sources/corticon/classify/null-guard-classifier.js';
import { classifyDecisionTableAlternativeRows } from '../sources/corticon/classify/decision-table-classifier.js';
import { classifyExpressionPatterns } from '../sources/corticon/classify/expression-patterns.js';

test('classifies IRR\'s real self-loop as a genuine cycle -- inside the iterative loop', () => {
  const project = loadProject('fixtures/corticon/vendor-samples/irr');
  const ctx = resolveRuleflowContext(project);
  const results = classifyCycles(project, ctx);
  assert.ok(results.length > 0);
  assert.ok(results.every((r) => r.node === 'Investment.irr' && r.pattern === 'cycle'));
});

test('classifies IRR\'s real multi-hop cycle (npv -> irr -> portion -> npv) as a genuine cycle, spanning two rulesheets', () => {
  // Confirmed real: `evaluate npv.ers` computes Investment.npv from Cashflow.portion
  // and updates Investment.irr from Investment.npv; `solve each cashflow.ers`
  // discounts each Cashflow.portion by the current Investment.irr guess. Both
  // rulesheets are reached from the same iterative loop.
  const project = loadProject('fixtures/corticon/vendor-samples/irr');
  const ctx = resolveRuleflowContext(project);
  const results = classifyMultiHopCycles(project, ctx);
  assert.equal(results.length, 1);
  assert.deepEqual(results[0].nodes.sort(), ['Cashflow.portion', 'Investment.irr', 'Investment.npv']);
  assert.equal(results[0].pattern, 'cycle');
  assert.equal(results[0].variant, undefined);
});

test('classifies DC Medicaid\'s two real self-loop-causing rules on the same path distinctly', () => {
  // Person.outputCoverage1 has TWO independent self-referencing rules within
  // Flatten.ers: one an explicit null-check (masking), one a content-check
  // (an ordinary decision-table alternative row) -- confirmed real.
  const project = loadProject('fixtures/corticon/government/dc-medicaid-chip');
  const ctx = resolveRuleflowContext(project);
  const nullGuards = classifyNullGuards(project);
  const dtAltRows = classifyDecisionTableAlternativeRows(project, ctx);
  // Flatten.ers has another writer of outputCoverage1 (the decision-table-alternative-row
  // rule), so the null-guard is classified as fallback, not default.
  assert.ok(nullGuards.some((r) => r.pattern === 'null-guard' && r.node === 'Person.outputCoverage1'));
  assert.ok(dtAltRows.some((r) => r.pattern === 'decision-table-alternative-row'));
});

test('classifies Mortgage\'s real null-check-masking self-loops correctly', () => {
  const project = loadProject('fixtures/corticon/vendor-samples/mortgage');
  const results = classifyNullGuards(project);
  assert.equal(results.length, 4);
  assert.ok(results.every((r) => r.pattern === 'null-guard' && r.variant === 'default'));
});

test('all-patterns: classifies the genuine cycle and the null-check masking self-loops distinctly', () => {
  const project = loadProject('fixtures/corticon/synthetic/all-patterns');
  const ctx = resolveRuleflowContext(project);
  const cycles = classifyCycles(project, ctx);
  const nullGuards = classifyNullGuards(project);
  assert.ok(cycles.some((r) => r.node === 'Application.estimatedBenefit' && r.pattern === 'cycle'));
  assert.ok(nullGuards.some((r) => r.node === 'ApplicationMember.reportedAssets' && r.variant === 'default'));
});

test('snap-work-requirements: decimal-rounding self-loop (adjustedHours = adjustedHours.round(1)) is suppressed when expressionPatterns are passed -- not a decision-table-alternative-row', () => {
  // decimal-rounding.ers writes and reads ApplicationMember.adjustedHours in the
  // same action, producing a structural self-loop. Without expressionPatterns, the
  // catch-all would label it decision-table-alternative-row (false positive). With
  // expressionPatterns passed in, the decimal-rounding classification on the same
  // rule explains the self-loop and the entry is suppressed.
  const project = loadProject('fixtures/corticon/synthetic/snap-work-requirements');
  const ctx = resolveRuleflowContext(project);
  const exprPatterns = classifyExpressionPatterns(project);
  const expressionPatternRuleIds = new Set(exprPatterns.map((f) => f.ruleId));
  const withoutExpr = classifyDecisionTableAlternativeRows(project, ctx);
  const withExpr = classifyDecisionTableAlternativeRows(project, ctx, expressionPatternRuleIds);
  assert.ok(
    withoutExpr.some((r) => r.ruleId?.startsWith('decimal-rounding.ers') && r.pattern === 'decision-table-alternative-row'),
    'without expressionPatterns, decimal-rounding.ers gets a false-positive decision-table-alternative-row entry',
  );
  assert.ok(
    !withExpr.some((r) => r.ruleId?.startsWith('decimal-rounding.ers')),
    'with expressionPatterns, decimal-rounding.ers self-loop is suppressed',
  );
});

test('flags a non-iterative multi-hop cycle as unclassified -- not observed in any real fixture, exercised with minimal synthetic data', () => {
  function makeTerm(entity, attr) {
    return { termtype: 'ATTRIBUTE', text: attr, parent: { datatype: entity } };
  }
  const project = {
    rulesheets: {
      'one.ers': {
        rules: [
          {
            conditions: [{ referencedTerms: [makeTerm('Entity', 'a')] }],
            actions: [{ modifiedTerms: [makeTerm('Entity', 'b')], referencedTerms: [] }],
          },
        ],
      },
      'two.ers': {
        rules: [
          {
            conditions: [{ referencedTerms: [makeTerm('Entity', 'b')] }],
            actions: [{ modifiedTerms: [makeTerm('Entity', 'a')], referencedTerms: [] }],
          },
        ],
      },
    },
  };
  const ruleflowContext = { perRulesheet: new Map([['one.ers', { iterative: false }], ['two.ers', { iterative: false }]]) };
  const results = classifyMultiHopCycles(project, ruleflowContext);
  assert.equal(results.length, 1);
  assert.equal(results[0].pattern, 'cycle');
  assert.equal(results[0].variant, 'unclassified');
});
