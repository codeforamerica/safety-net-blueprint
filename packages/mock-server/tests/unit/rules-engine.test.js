/**
 * Unit tests for the rules engine
 * Tests rule condition evaluation and context building
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { evaluateRuleSet, buildRuleContext } from '../../src/rules-engine.js';

// =============================================================================
// buildRuleContext
// =============================================================================

test('buildRuleContext — builds context from task.* binding', () => {
  const resource = { id: 'task-1', programType: 'snap', isExpedited: true };
  const context = buildRuleContext(['task.*'], resource);
  assert.deepStrictEqual(context, { task: { id: 'task-1', programType: 'snap', isExpedited: true } });
});

test('buildRuleContext — handles multiple bindings', () => {
  const resource = { id: 'task-1', status: 'pending' };
  const context = buildRuleContext(['task.*', 'item.*'], resource);
  assert.deepStrictEqual(context.task, { id: 'task-1', status: 'pending' });
  assert.deepStrictEqual(context.item, { id: 'task-1', status: 'pending' });
});

test('buildRuleContext — handles null/empty bindings', () => {
  const resource = { id: 'task-1' };
  assert.deepStrictEqual(buildRuleContext(null, resource), {});
  assert.deepStrictEqual(buildRuleContext([], resource), {});
});

// =============================================================================
// evaluateRuleSet — matching conditions
// =============================================================================

test('evaluateRuleSet — matches JSON Logic condition', () => {
  const ruleSet = {
    rules: [
      {
        id: 'rule-1',
        order: 1,
        condition: { '==': [{ var: 'task.programType' }, 'snap'] },
        action: { assignToQueue: 'snap-intake' }
      }
    ]
  };
  const context = { task: { programType: 'snap' } };
  const result = evaluateRuleSet(ruleSet, context);
  assert.strictEqual(result.matched, true);
  assert.strictEqual(result.ruleId, 'rule-1');
  assert.deepStrictEqual(result.action, { assignToQueue: 'snap-intake' });
});

test('evaluateRuleSet — non-matching condition returns matched:false', () => {
  const ruleSet = {
    rules: [
      {
        id: 'rule-1',
        order: 1,
        condition: { '==': [{ var: 'task.programType' }, 'snap'] },
        action: { assignToQueue: 'snap-intake' }
      }
    ]
  };
  const context = { task: { programType: 'tanf' } };
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
  const result = evaluateRuleSet(ruleSet, { task: { programType: 'tanf' } });
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
        condition: { '==': [{ var: 'task.programType' }, 'snap'] },
        action: { assignToQueue: 'snap-intake' }
      }
    ]
  };
  const context = { task: { programType: 'snap' } };
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
  const result = evaluateRuleSet(ruleSet, {});
  assert.strictEqual(result.matched, true);
  assert.deepStrictEqual(result.fallbackAction, { assignToQueue: 'general-intake' });
});

test('evaluateRuleSet — handles null/empty ruleSet', () => {
  assert.deepStrictEqual(evaluateRuleSet(null, {}), { matched: false });
  assert.deepStrictEqual(evaluateRuleSet({}, {}), { matched: false });
  assert.deepStrictEqual(evaluateRuleSet({ rules: [] }, {}), { matched: false });
});

test('evaluateRuleSet — boolean equality with isExpedited', () => {
  const ruleSet = {
    rules: [
      {
        id: 'expedited',
        order: 1,
        condition: { '==': [{ var: 'task.isExpedited' }, true] },
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

  const expedited = evaluateRuleSet(ruleSet, { task: { isExpedited: true } });
  assert.strictEqual(expedited.ruleId, 'expedited');

  const normal = evaluateRuleSet(ruleSet, { task: { isExpedited: false } });
  assert.strictEqual(normal.ruleId, 'default');
});
