/**
 * Unit tests for the rules engine
 * Tests rule condition evaluation and context building
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { evaluateRuleSet, evaluateAllMatchRuleSet, buildRuleContext, resolvePath } from '../../src/rules-engine.js';

// =============================================================================
// resolvePath
// =============================================================================

test('resolvePath — resolves single-segment path', () => {
  const resource = { subjectId: 'app-1', status: 'pending' };
  assert.strictEqual(resolvePath(resource, 'subjectId'), 'app-1');
});

test('resolvePath — resolves nested path', () => {
  const resource = { meta: { county: 'alameda' } };
  assert.strictEqual(resolvePath(resource, 'meta.county'), 'alameda');
});

test('resolvePath — resolves path across resolved entity (chaining)', () => {
  const context = { subjectId: 'app-1', application: { caseId: 'case-99' } };
  assert.strictEqual(resolvePath(context, 'application.caseId'), 'case-99');
});

test('resolvePath — returns undefined for missing field', () => {
  const resource = { status: 'pending' };
  assert.strictEqual(resolvePath(resource, 'subjectId'), undefined);
});

// =============================================================================
// buildRuleContext
// =============================================================================

test('buildRuleContext — calling resource available as "this"', () => {
  const resource = { id: 'task-1', isExpedited: true };
  const context = buildRuleContext(resource);
  assert.deepStrictEqual(context, { this: { id: 'task-1', isExpedited: true } });
});

test('buildRuleContext — merges resolvedEntities alongside "this"', () => {
  const resource = { id: 'task-1', subjectId: 'app-1' };
  const resolvedEntities = { application: { id: 'app-1', programs: ['snap'] } };
  const context = buildRuleContext(resource, resolvedEntities);
  assert.deepStrictEqual(context.this, { id: 'task-1', subjectId: 'app-1' });
  assert.deepStrictEqual(context.application, { id: 'app-1', programs: ['snap'] });
});

test('buildRuleContext — handles empty resolvedEntities', () => {
  const resource = { id: 'task-1' };
  assert.deepStrictEqual(buildRuleContext(resource, {}), { this: { id: 'task-1' } });
  assert.deepStrictEqual(buildRuleContext(resource), { this: { id: 'task-1' } });
});

// =============================================================================
// evaluateRuleSet — conditions using "this" alias
// =============================================================================

test('evaluateRuleSet — condition references calling resource via "this"', () => {
  const ruleSet = {
    rules: [
      {
        id: 'expedited',
        order: 1,
        condition: { '==': [{ var: 'this.isExpedited' }, true] },
        action: { setPriority: 'expedited' }
      }
    ]
  };
  const context = buildRuleContext({ id: 'task-1', isExpedited: true });
  const result = evaluateRuleSet(ruleSet, context);
  assert.strictEqual(result.matched, true);
  assert.strictEqual(result.ruleId, 'expedited');
});

test('evaluateRuleSet — condition references resolved entity field', () => {
  const ruleSet = {
    rules: [
      {
        id: 'snap-rule',
        order: 1,
        condition: { in: ['snap', { var: 'application.programs' }] },
        action: { assignToQueue: 'snap-intake' }
      }
    ]
  };
  const context = buildRuleContext(
    { id: 'task-1', subjectId: 'app-1' },
    { application: { id: 'app-1', programs: ['snap', 'medicaid'] } }
  );
  const result = evaluateRuleSet(ruleSet, context);
  assert.strictEqual(result.matched, true);
  assert.strictEqual(result.ruleId, 'snap-rule');
});

// =============================================================================
// evaluateRuleSet — matching conditions
// =============================================================================

test('evaluateRuleSet — non-matching condition returns matched:false', () => {
  const ruleSet = {
    rules: [
      {
        id: 'rule-1',
        order: 1,
        condition: { '==': [{ var: 'this.isExpedited' }, true] },
        action: { setPriority: 'expedited' }
      }
    ]
  };
  const context = buildRuleContext({ isExpedited: false });
  const result = evaluateRuleSet(ruleSet, context);
  assert.strictEqual(result.matched, false);
});

test('evaluateRuleSet — catch-all with condition: true', () => {
  const ruleSet = {
    rules: [
      {
        id: 'catch-all',
        order: 1,
        condition: true,
        action: { assignToQueue: 'general-intake' }
      }
    ]
  };
  const result = evaluateRuleSet(ruleSet, buildRuleContext({ id: 'task-1' }));
  assert.strictEqual(result.matched, true);
  assert.strictEqual(result.ruleId, 'catch-all');
  assert.deepStrictEqual(result.action, { assignToQueue: 'general-intake' });
});

test('evaluateRuleSet — first-match-wins order', () => {
  const ruleSet = {
    rules: [
      {
        id: 'catch-all',
        order: 2,
        condition: true,
        action: { assignToQueue: 'general-intake' }
      },
      {
        id: 'snap-rule',
        order: 1,
        condition: { in: ['snap', { var: 'application.programs' }] },
        action: { assignToQueue: 'snap-intake' }
      }
    ]
  };
  const context = buildRuleContext(
    { id: 'task-1' },
    { application: { programs: ['snap'] } }
  );
  const result = evaluateRuleSet(ruleSet, context);
  // Should match snap-rule (order 1) even though catch-all is listed first
  assert.strictEqual(result.ruleId, 'snap-rule');
});

test('evaluateRuleSet — returns fallbackAction when present', () => {
  const ruleSet = {
    rules: [
      {
        id: 'rule-1',
        order: 1,
        condition: true,
        action: { assignToQueue: 'snap-intake' },
        fallbackAction: { assignToQueue: 'general-intake' }
      }
    ]
  };
  const result = evaluateRuleSet(ruleSet, buildRuleContext({}));
  assert.strictEqual(result.matched, true);
  assert.deepStrictEqual(result.fallbackAction, { assignToQueue: 'general-intake' });
});

test('evaluateRuleSet — handles null/empty ruleSet', () => {
  assert.deepStrictEqual(evaluateRuleSet(null, {}), { matched: false });
  assert.deepStrictEqual(evaluateRuleSet({}, {}), { matched: false });
  assert.deepStrictEqual(evaluateRuleSet({ rules: [] }, {}), { matched: false });
});

// =============================================================================
// evaluateAllMatchRuleSet
// =============================================================================

test('evaluateAllMatchRuleSet — returns all matching rules, not just first', () => {
  const ruleSet = {
    rules: [
      { id: 'snap-doc', order: 1, condition: { in: ['snap', { var: 'application.programs' }] }, action: { setPriority: 'expedited' } },
      { id: 'medicaid-doc', order: 2, condition: { in: ['medicaid', { var: 'application.programs' }] }, action: { setPriority: 'high' } },
      { id: 'no-match', order: 3, condition: { '==': [1, 2] }, action: { setPriority: 'low' } }
    ]
  };
  const context = buildRuleContext({}, { application: { programs: ['snap', 'medicaid'] } });
  const results = evaluateAllMatchRuleSet(ruleSet, context);
  assert.strictEqual(results.length, 2);
  assert.strictEqual(results[0].ruleId, 'snap-doc');
  assert.strictEqual(results[1].ruleId, 'medicaid-doc');
});

test('evaluateAllMatchRuleSet — returns empty array when no rules match', () => {
  const ruleSet = {
    rules: [
      { id: 'snap-doc', order: 1, condition: { in: ['snap', { var: 'application.programs' }] }, action: {} }
    ]
  };
  const context = buildRuleContext({}, { application: { programs: ['medicaid'] } });
  assert.deepStrictEqual(evaluateAllMatchRuleSet(ruleSet, context), []);
});

test('evaluateAllMatchRuleSet — handles null/empty ruleSet', () => {
  assert.deepStrictEqual(evaluateAllMatchRuleSet(null, {}), []);
  assert.deepStrictEqual(evaluateAllMatchRuleSet({}, {}), []);
  assert.deepStrictEqual(evaluateAllMatchRuleSet({ rules: [] }, {}), []);
});

test('evaluateAllMatchRuleSet — catch-all with condition: true matches alongside specific rules', () => {
  const ruleSet = {
    rules: [
      { id: 'snap-rule', order: 1, condition: { in: ['snap', { var: 'application.programs' }] }, action: { setPriority: 'expedited' } },
      { id: 'catch-all', order: 2, condition: true, action: { setPriority: 'normal' } }
    ]
  };
  const context = buildRuleContext({}, { application: { programs: ['snap'] } });
  const results = evaluateAllMatchRuleSet(ruleSet, context);
  assert.strictEqual(results.length, 2);
  assert.strictEqual(results[0].ruleId, 'snap-rule');
  assert.strictEqual(results[1].ruleId, 'catch-all');
});

// =============================================================================
// evaluateRuleSet — boolean equality with isExpedited via "this"
// =============================================================================

// =============================================================================
// application-submitted-data-exchange — individual service calls per program
// =============================================================================

// Mirrors the all-match rule set in intake-rules.yaml. Tests verify that each
// service type fires for the correct program combination.
const dataExchangeRuleSet = {
  evaluation: 'all-match',
  rules: [
    { id: 'fdsh-ssa',  order: 1, condition: { or:  [{ in: ['snap',     { var: 'application.programs' }] }, { in: ['medicaid', { var: 'application.programs' }] }] }, action: { createResource: { entity: 'data-exchange/service-calls', fields: { serviceType: 'fdsh_ssa'  } } } },
    { id: 'ssa-ievs',  order: 2, condition: { or:  [{ in: ['snap',     { var: 'application.programs' }] }, { in: ['medicaid', { var: 'application.programs' }] }] }, action: { createResource: { entity: 'data-exchange/service-calls', fields: { serviceType: 'ssa_ievs'  } } } },
    { id: 'irs-ievs',  order: 3, condition: { in:   ['snap',     { var: 'application.programs' }] },                                                                  action: { createResource: { entity: 'data-exchange/service-calls', fields: { serviceType: 'irs_ievs'  } } } },
    { id: 'swica',     order: 4, condition: { in:   ['snap',     { var: 'application.programs' }] },                                                                  action: { createResource: { entity: 'data-exchange/service-calls', fields: { serviceType: 'swica'     } } } },
    { id: 'uib',       order: 5, condition: { in:   ['snap',     { var: 'application.programs' }] },                                                                  action: { createResource: { entity: 'data-exchange/service-calls', fields: { serviceType: 'uib'       } } } },
    { id: 'fdsh-vlp',  order: 6, condition: { in:   ['medicaid', { var: 'application.programs' }] },                                                                  action: { createResource: { entity: 'data-exchange/service-calls', fields: { serviceType: 'fdsh_vlp'  } } } },
  ]
};

test('data-exchange rules — SNAP+Medicaid fires fdsh_ssa, ssa_ievs, irs_ievs, swica, uib, fdsh_vlp', () => {
  const context = buildRuleContext({}, { application: { programs: ['snap', 'medicaid'] } });
  const results = evaluateAllMatchRuleSet(dataExchangeRuleSet, context);
  assert.deepStrictEqual(results.map(r => r.ruleId), ['fdsh-ssa', 'ssa-ievs', 'irs-ievs', 'swica', 'uib', 'fdsh-vlp']);
});

test('data-exchange rules — SNAP-only fires fdsh_ssa, ssa_ievs, irs_ievs, swica, uib; not fdsh_vlp', () => {
  const context = buildRuleContext({}, { application: { programs: ['snap'] } });
  const results = evaluateAllMatchRuleSet(dataExchangeRuleSet, context);
  assert.deepStrictEqual(results.map(r => r.ruleId), ['fdsh-ssa', 'ssa-ievs', 'irs-ievs', 'swica', 'uib']);
});

test('data-exchange rules — Medicaid-only fires fdsh_ssa, ssa_ievs, fdsh_vlp; not SNAP-only services', () => {
  const context = buildRuleContext({}, { application: { programs: ['medicaid'] } });
  const results = evaluateAllMatchRuleSet(dataExchangeRuleSet, context);
  assert.deepStrictEqual(results.map(r => r.ruleId), ['fdsh-ssa', 'ssa-ievs', 'fdsh-vlp']);
});

// =============================================================================
// vlp-inconclusive-initiate-save — VLP→SAVE chain
// =============================================================================

// Mirrors the first-match-wins rule set in intake-rules.yaml triggered by
// data_exchange.call.completed when fdsh_vlp returns inconclusive.
const vlpChainRuleSet = {
  evaluation: 'first-match-wins',
  rules: [
    {
      id: 'save-on-vlp-inconclusive',
      order: 1,
      condition: { and: [{ '==': [{ var: 'this.data.serviceType' }, 'fdsh_vlp'] }, { '==': [{ var: 'this.data.result' }, 'inconclusive'] }] },
      action: { createResource: { entity: 'data-exchange/service-calls', fields: { serviceType: 'save' } } }
    }
  ]
};

test('VLP→SAVE chain — fires SAVE when fdsh_vlp returns inconclusive', () => {
  const context = buildRuleContext({ data: { serviceType: 'fdsh_vlp', result: 'inconclusive' } });
  const result = evaluateRuleSet(vlpChainRuleSet, context);
  assert.strictEqual(result.matched, true);
  assert.strictEqual(result.ruleId, 'save-on-vlp-inconclusive');
});

test('VLP→SAVE chain — does not fire when fdsh_vlp result is not inconclusive', () => {
  const context = buildRuleContext({ data: { serviceType: 'fdsh_vlp', result: 'verified' } });
  const result = evaluateRuleSet(vlpChainRuleSet, context);
  assert.strictEqual(result.matched, false);
});

test('VLP→SAVE chain — does not fire for other service types even when result is inconclusive', () => {
  const context = buildRuleContext({ data: { serviceType: 'fdsh_ssa', result: 'inconclusive' } });
  const result = evaluateRuleSet(vlpChainRuleSet, context);
  assert.strictEqual(result.matched, false);
});

// =============================================================================
// evaluateRuleSet — boolean equality with isExpedited via "this"
// =============================================================================

test('evaluateRuleSet — boolean equality with isExpedited via "this"', () => {
  const ruleSet = {
    rules: [
      {
        id: 'expedited',
        order: 1,
        condition: { '==': [{ var: 'this.isExpedited' }, true] },
        action: { setPriority: 'expedited' }
      },
      {
        id: 'default',
        order: 2,
        condition: true,
        action: { setPriority: 'normal' }
      }
    ]
  };

  const expedited = evaluateRuleSet(ruleSet, buildRuleContext({ isExpedited: true }));
  assert.strictEqual(expedited.ruleId, 'expedited');

  const normal = evaluateRuleSet(ruleSet, buildRuleContext({ isExpedited: false }));
  assert.strictEqual(normal.ruleId, 'default');
});
