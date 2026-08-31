import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProject } from '../sources/corticon/project.js';
import { classifyHitPolicyUnverified } from '../sources/corticon/classify/decision-table-classifier.js';

function makeTerm(entity, attr) {
  return { termtype: 'ATTRIBUTE', text: attr, parent: { datatype: entity } };
}

test('classifies Mortgage\'s real Select_Credit.ers 3-row decision table converging on one write', () => {
  const project = loadProject('fixtures/corticon/vendor-samples/mortgage');
  const results = classifyHitPolicyUnverified(project).filter((r) => r.ruleId.includes('Select_Credit.ers'));
  assert.equal(results.length, 1);
  assert.equal(results[0].node, 'LoanApplication.creditReqtMet');
  assert.equal(results[0].pattern, 'hit-policy-unverified');
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
  assert.deepEqual(classifyHitPolicyUnverified(project), []);
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
  const results = classifyHitPolicyUnverified(project);
  assert.equal(results.length, 1);
  assert.equal(results[0].node, 'Foo.bar');
  assert.equal(results[0].ruleId, 'one.ers:*');
});
