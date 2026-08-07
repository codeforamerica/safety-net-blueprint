import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProject } from '../sources/corticon/corticon/project.js';
import { resolveRuleflowContext } from '../sources/corticon/classify/ruleflow-context.js';
import { classifySelfLoops, classifyMultiHopCycles } from '../sources/corticon/classify/cycle-classifier.js';
import { classifyExpressionPatterns } from '../sources/corticon/classify/expression-patterns.js';

test('classifies IRR\'s real self-loop as a genuine cycle -- inside the iterative loop', () => {
  const project = loadProject('fixtures/corticon/vendor-samples/irr');
  const ctx = resolveRuleflowContext(project);
  const results = classifySelfLoops(project, ctx);
  assert.ok(results.length > 0);
  assert.ok(results.every((r) => r.path === 'Investment.irr' && r.classification === 'genuine-cycle'));
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
  assert.deepEqual(results[0].path.sort(), ['Cashflow.portion', 'Investment.irr', 'Investment.npv']);
  assert.deepEqual(results[0].rulesheets.sort(), ['evaluate npv.ers', 'solve each cashflow.ers']);
  assert.equal(results[0].classification, 'genuine-cycle');
});

test('classifies DC Medicaid\'s two real self-loop-causing rules on the same path distinctly', () => {
  // Person.outputCoverage1 has TWO independent self-referencing rules within
  // Flatten.ers: one an explicit null-check (masking), one a content-check
  // (an ordinary decision-table alternative row) -- confirmed real, and only
  // fully visible once the method-term/action-scoping graph bugs were fixed.
  const project = loadProject('fixtures/corticon/government/dc-medicaid-chip');
  const ctx = resolveRuleflowContext(project);
  const results = classifySelfLoops(project, ctx);
  assert.deepEqual(
    results.map((r) => r.classification).sort(),
    ['decision-table-alternative-row', 'null-check-masking']
  );
});

test('classifies Mortgage\'s real null-check-masking self-loops correctly', () => {
  const project = loadProject('fixtures/corticon/vendor-samples/mortgage');
  const ctx = resolveRuleflowContext(project);
  const results = classifySelfLoops(project, ctx);
  assert.equal(results.length, 4);
  assert.ok(results.every((r) => r.classification === 'null-check-masking'));
});

test('all-patterns: classifies the genuine cycle and the null-check masking self-loops distinctly', () => {
  const project = loadProject('fixtures/corticon/synthetic/all-patterns');
  const ctx = resolveRuleflowContext(project);
  const results = classifySelfLoops(project, ctx);
  const byPath = Object.fromEntries(results.map((r) => [r.path, r.classification]));
  assert.equal(byPath['Application.estimatedBenefit'], 'genuine-cycle');
  assert.equal(byPath['ApplicationMember.reportedAssets'], 'null-check-masking');
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
  const withoutExpr = classifySelfLoops(project, ctx);
  const withExpr = classifySelfLoops(project, ctx, exprPatterns);
  assert.ok(
    withoutExpr.some((r) => r.rulesheet === 'decimal-rounding.ers' && r.classification === 'decision-table-alternative-row'),
    'without expressionPatterns, decimal-rounding.ers gets a false-positive decision-table-alternative-row entry',
  );
  assert.ok(
    !withExpr.some((r) => r.rulesheet === 'decimal-rounding.ers'),
    'with expressionPatterns, decimal-rounding.ers self-loop is suppressed',
  );
});

test('flags a non-iterative multi-hop cycle as unclassified -- not observed in any real fixture, exercised with minimal synthetic data', () => {
  // No real or fixture project has a multi-node cycle outside an iterative
  // context; this proves the defensive fallback itself works rather than
  // silently mislabeling something we have no real evidence about as a
  // "genuine cycle."
  //
  // Synthetic project: one.ers has a rule that reads Entity.a and writes
  // Entity.b; two.ers has a rule that reads Entity.b and writes Entity.a.
  // Together they form a two-node cycle (Entity.a -> Entity.b -> Entity.a)
  // that is longer than 1 hop, triggering the multi-hop path.
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
  assert.equal(results[0].classification, 'unclassified-multi-hop-cycle');
});
