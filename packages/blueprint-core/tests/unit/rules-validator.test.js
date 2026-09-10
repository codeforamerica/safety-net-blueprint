/**
 * Unit tests for the rules validator.
 * Covers: cycle detection, unreachable node detection, CEL syntax, $ref resolution.
 * Schema correctness is handled by JSON Schema validation — not tested here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectCycles,
  detectUnreachable,
  checkCelSyntax,
  canResolveRef,
  validateRuleset,
  validateRulesDoc,
} from '../../src/rules-validator.js';

// ── detectCycles ──────────────────────────────────────────────────────────────

test('detectCycles', async (t) => {

  await t.test('returns empty array when there are no cycles', () => {
    const facts = {
      passesIncomeTest: { expression: 'household.income < 150' },
      eligible: { expression: 'passesIncomeTest' },
    };
    const dependencies = {
      passesIncomeTest: ['$.household.income'],
      eligible: ['passesIncomeTest'],
    };
    assert.deepEqual(detectCycles(facts, dependencies), []);
  });

  await t.test('detects a direct self-cycle', () => {
    const facts = { a: { expression: 'a' } };
    const dependencies = { a: ['a'] };
    assert.deepEqual(detectCycles(facts, dependencies), ['a']);
  });

  await t.test('detects a two-fact cycle', () => {
    const facts = {
      a: { expression: 'b' },
      b: { expression: 'a' },
    };
    const dependencies = { a: ['b'], b: ['a'] };
    const inCycle = detectCycles(facts, dependencies);
    assert.ok(inCycle.includes('a'));
    assert.ok(inCycle.includes('b'));
  });

  await t.test('does not flag input paths as cycles', () => {
    const facts = { eligible: { expression: 'household.income < 150' } };
    const dependencies = { eligible: ['$.household.income'] };
    assert.deepEqual(detectCycles(facts, dependencies), []);
  });

});

// ── detectUnreachable ─────────────────────────────────────────────────────────

test('detectUnreachable', async (t) => {

  await t.test('returns empty when all facts are reachable via outputs', () => {
    const facts = {
      passesIncomeTest: { expression: '...' },
      eligible: { expression: '...' },
    };
    const dependencies = { eligible: ['passesIncomeTest'] };
    assert.deepEqual(detectUnreachable(facts, dependencies, ['eligible']), []);
  });

  await t.test('detects a fact not in outputs and not depended on', () => {
    const facts = {
      orphan: { expression: '...' },
      eligible: { expression: '...' },
    };
    const dependencies = { eligible: ['$.household.income'] };
    const unreachable = detectUnreachable(facts, dependencies, ['eligible']);
    assert.deepEqual(unreachable, ['orphan']);
  });

  await t.test('does not flag intermediate facts that are depended on', () => {
    const facts = {
      passesIncomeTest: { expression: '...' },
      eligible: { expression: '...' },
    };
    const dependencies = { eligible: ['passesIncomeTest', '$.household.income'] };
    assert.deepEqual(detectUnreachable(facts, dependencies, ['eligible']), []);
  });

});

// ── checkCelSyntax ────────────────────────────────────────────────────────────

test('checkCelSyntax', async (t) => {

  await t.test('returns null for a valid expression', () => {
    assert.equal(checkCelSyntax('household.income < policy.limit'), null);
  });

  await t.test('returns null for a valid filter expression', () => {
    assert.equal(checkCelSyntax('household.members.filter(m, m.age >= 18)'), null);
  });

  await t.test('returns an error message for invalid syntax', () => {
    const result = checkCelSyntax('household.income <');
    assert.ok(result, 'should return an error message');
    assert.equal(typeof result, 'string');
  });

  await t.test('returns an error for an empty expression', () => {
    assert.ok(checkCelSyntax(''));
    assert.ok(checkCelSyntax('   '));
    assert.ok(checkCelSyntax(null));
  });

});

// ── canResolveRef ─────────────────────────────────────────────────────────────

test('canResolveRef', async (t) => {

  await t.test('returns true for a canonical blueprint schema URI that exists', () => {
    assert.ok(canResolveRef('https://blueprint.codeforamerica.org/schemas/graph-schema.yaml'));
  });

  await t.test('returns true for a canonical base URI that exists', () => {
    assert.ok(canResolveRef('https://blueprint.codeforamerica.org/base/schemas/rules-evaluation.yaml'));
  });

  await t.test('returns false for a canonical URI that does not exist', () => {
    assert.equal(canResolveRef('https://blueprint.codeforamerica.org/schemas/nonexistent.yaml'), false);
  });

  await t.test('returns true for non-canonical refs (validated elsewhere)', () => {
    assert.ok(canResolveRef('#/components/schemas/Foo'));
    assert.ok(canResolveRef('./relative-path.yaml'));
  });

  await t.test('returns false for an unknown canonical URI', () => {
    assert.equal(canResolveRef('https://blueprint.codeforamerica.org/unknown/thing.yaml'), false);
  });

});

// ── validateRuleset ───────────────────────────────────────────────────────────

test('validateRuleset', async (t) => {

  const validRuleset = {
    inputs: {
      household: {
        type: 'object',
        properties: {
          monthlyIncome: { type: 'number' },
          isDestituteMigrant: { type: 'boolean' },
        },
      },
      policy: {
        type: 'object',
        properties: {
          incomeLimit: { type: 'number', default: 150 },
        },
      },
    },
    outputs: { type: 'object', properties: { eligible: { type: 'boolean' } } },
    facts: [
      {
        path: 'passesIncomeTest',
        expression: 'household.monthlyIncome < policy.incomeLimit',
        type: { type: 'boolean' },
      },
      {
        path: 'eligible',
        expression: 'passesIncomeTest || household.isDestituteMigrant',
        type: { type: 'boolean' },
      },
    ],
  };

  await t.test('returns no errors for a valid ruleset', () => {
    const errors = validateRuleset('eligibility', 'expeditedSnap', validRuleset);
    assert.deepEqual(errors, []);
  });

  await t.test('reports a cycle', () => {
    const ruleset = {
      inputs: {},
      outputs: { type: 'object', properties: { a: { type: 'boolean' } } },
      facts: [
        { path: 'a', expression: 'b', type: { type: 'boolean' } },
        { path: 'b', expression: 'a', type: { type: 'boolean' } },
      ],
    };
    const errors = validateRuleset('test', 'cycleTest', ruleset);
    assert.ok(errors.some(e => e.rule === 'no-cycles'));
  });

  await t.test('reports an unreachable fact', () => {
    const ruleset = {
      inputs: {
        household: { type: 'object', properties: { income: { type: 'number' } } },
      },
      outputs: { type: 'object', properties: { eligible: { type: 'boolean' } } },
      facts: [
        { path: 'eligible', expression: 'household.income < 150', type: { type: 'boolean' } },
        { path: 'orphan', expression: 'true', type: { type: 'boolean' } },
      ],
    };
    const errors = validateRuleset('test', 'unreachableTest', ruleset);
    assert.ok(errors.some(e => e.rule === 'no-unreachable' && e.message.includes('orphan')));
  });

  await t.test('reports an invalid CEL expression', () => {
    const ruleset = {
      inputs: {},
      outputs: { type: 'object', properties: { eligible: { type: 'boolean' } } },
      facts: [
        { path: 'eligible', expression: 'household.income <', type: { type: 'boolean' } },
      ],
    };
    const errors = validateRuleset('test', 'celTest', ruleset);
    assert.ok(errors.some(e => e.rule === 'cel-syntax'));
  });

  await t.test('reports a forward reference', () => {
    const ruleset = {
      inputs: {},
      outputs: { type: 'object', properties: { b: { type: 'boolean' } } },
      facts: [
        // a references b, but b is declared after a
        { path: 'a', expression: 'b', type: { type: 'boolean' } },
        { path: 'b', expression: 'true', type: { type: 'boolean' } },
      ],
    };
    const errors = validateRuleset('test', 'forwardRefTest', ruleset);
    assert.ok(errors.some(e => e.rule === 'no-forward-refs' && e.message.includes('"a"') && e.message.includes('"b"')));
  });

  await t.test('does not flag a valid backward reference', () => {
    const ruleset = {
      inputs: {},
      outputs: { type: 'object', properties: { b: { type: 'boolean' } } },
      facts: [
        { path: 'a', expression: 'true', type: { type: 'boolean' } },
        { path: 'b', expression: 'a', type: { type: 'boolean' } }, // a is declared before b — valid
      ],
    };
    const errors = validateRuleset('test', 'backwardRefTest', ruleset);
    assert.ok(!errors.some(e => e.rule === 'no-forward-refs'));
  });

  await t.test('reports an unresolvable $ref', () => {
    const ruleset = {
      inputs: {
        person: { $ref: 'https://blueprint.codeforamerica.org/schemas/nonexistent.yaml' },
      },
      outputs: { type: 'object', properties: { eligible: { type: 'boolean' } } },
      facts: [
        { path: 'eligible', expression: 'true', type: { type: 'boolean' } },
      ],
    };
    const errors = validateRuleset('test', 'refTest', ruleset);
    assert.ok(errors.some(e => e.rule === 'ref-resolution'));
  });

});

// ── validateRulesDoc ──────────────────────────────────────────────────────────

test('validateRulesDoc', async (t) => {

  await t.test('returns no errors for a valid rules document', () => {
    const doc = {
      domain: 'eligibility',
      rulesets: {
        expeditedSnap: {
          inputs: {
            household: { type: 'object', properties: { income: { type: 'number' } } },
          },
          outputs: { type: 'object', properties: { eligible: { type: 'boolean' } } },
          facts: [
            { path: 'eligible', expression: 'household.income < 150', type: { type: 'boolean' } },
          ],
        },
      },
    };
    assert.deepEqual(validateRulesDoc(doc), []);
  });

  await t.test('validates all rulesets in a document', () => {
    const doc = {
      domain: 'test',
      rulesets: {
        rulesetA: {
          inputs: {},
          outputs: { type: 'object', properties: { a: { type: 'boolean' } } },
          facts: [{ path: 'a', expression: 'true', type: { type: 'boolean' } }],
        },
        rulesetB: {
          inputs: {},
          outputs: { type: 'object', properties: { b: { type: 'boolean' } } },
          facts: [
            { path: 'b', expression: 'household.income <', type: { type: 'boolean' } }, // invalid CEL
          ],
        },
      },
    };
    const errors = validateRulesDoc(doc);
    assert.ok(errors.some(e => e.rule === 'cel-syntax' && e.path.includes('rulesetB')));
    assert.ok(!errors.some(e => e.path.includes('rulesetA')));
  });

});
