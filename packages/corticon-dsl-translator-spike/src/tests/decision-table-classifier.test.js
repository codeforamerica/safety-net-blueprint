import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProject } from '../sources/corticon/corticon/project.js';
import { classifyDecisionTableCombinatorics } from '../sources/corticon/classify/decision-table-classifier.js';

function makeTerm(entity, attr) {
  return { termtype: 'ATTRIBUTE', text: attr, parent: { datatype: entity } };
}

test('classifies Mortgage\'s real Select_Credit.ers 3-row decision table converging on one write', () => {
  // Confirmed real: 3 rules (>= 3 liabilities AND a high-credit one; >= 3 liabilities
  // AND none high-credit; < 3 liabilities), each an independent alternative, all
  // writing loanapp.creditReqtMet -- no rule reads a path it also writes, so this is
  // not a self-loop, just ordinary decision-table combinatorics.
  const project = loadProject('fixtures/corticon/vendor-samples/mortgage');
  const results = classifyDecisionTableCombinatorics(project).filter((r) => r.rulesheet === 'Select_Credit.ers');
  assert.equal(results.length, 1);
  assert.equal(results[0].path, 'LoanApplication.creditReqtMet');
  assert.deepEqual(results[0].ruleIndices, [1, 2, 3], 'shifted by 1 vs. Corticon\'s own rule count: index 0 is the reserved blank/template row, now kept rather than filtered');
});

test('a path written by only one rule in its rulesheet is not flagged', () => {
  const project = {
    rulesheets: {
      'one.ers': {
        rules: [
          { conditions: [], actions: [{ modifiedTerms: [makeTerm('Foo', 'bar')], referencedTerms: [] }] },
        ],
      },
    },
  };
  assert.deepEqual(classifyDecisionTableCombinatorics(project), []);
});

test('two rules in the same rulesheet writing the same path are flagged', () => {
  const project = {
    rulesheets: {
      'one.ers': {
        rules: [
          { conditions: [], actions: [{ modifiedTerms: [makeTerm('Foo', 'bar')], referencedTerms: [] }] },
          { conditions: [], actions: [{ modifiedTerms: [makeTerm('Foo', 'bar')], referencedTerms: [] }] },
        ],
      },
    },
  };
  const results = classifyDecisionTableCombinatorics(project);
  assert.equal(results.length, 1);
  assert.deepEqual(results[0].ruleIndices, [0, 1]);
});
