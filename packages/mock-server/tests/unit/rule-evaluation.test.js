/**
 * Unit tests for rule-evaluation — specifically the context enrichment path
 * (resolveContextEntities + processRuleEvaluations with object-form bindings).
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { insertResource, clearAll, create } from '../../src/database-manager.js';
import { processRuleEvaluations } from '../../src/handlers/rule-evaluation.js';

// =============================================================================
// Helpers
// =============================================================================

function makeRules(contextBindings, condition, action) {
  return [
    {
      domain: 'workflow',
      context: contextBindings,
      ruleSets: [
        {
          id: 'test-ruleset',
          ruleType: 'assignment',
          evaluation: 'first-match-wins',
          rules: [
            { id: 'rule-1', order: 1, condition, action },
            { id: 'catch-all', order: 2, condition: true, action: { assignToQueue: 'general-intake' } }
          ]
        }
      ]
    }
  ];
}

function seedQueues() {
  clearAll('queues');
  insertResource('queues', { id: 'q-snap', name: 'snap-intake' });
  insertResource('queues', { id: 'q-general', name: 'general-intake' });
  insertResource('queues', { id: 'q-alameda', name: 'alameda-intake' });
}

// =============================================================================
// Object-form context binding — happy path
// =============================================================================

test('processRuleEvaluations — object-form binding resolves subject entity and makes fields available', () => {
  clearAll('applications');
  clearAll('tasks');
  seedQueues();

  insertResource('applications', { id: 'app-1', programs: ['snap'] });
  const task = { id: 'task-1', subjectId: 'app-1', queueId: null };

  const rules = makeRules(
    [
      'task.*',
      { as: 'application', entity: 'applications', from: 'task.subjectId' }
    ],
    { in: ['snap', { var: 'application.programs' }] },
    { assignToQueue: 'snap-intake' }
  );

  processRuleEvaluations([{ ruleType: 'assignment' }], task, rules, 'workflow');
  assert.strictEqual(task.queueId, 'q-snap');
});

test('processRuleEvaluations — object-form binding falls back when subject entity not found', () => {
  clearAll('applications');
  clearAll('tasks');
  seedQueues();

  const task = { id: 'task-1', subjectId: 'nonexistent', queueId: null };

  const rules = makeRules(
    [
      'task.*',
      { as: 'application', entity: 'applications', from: 'task.subjectId' }
    ],
    { in: ['snap', { var: 'application.programs' }] },
    { assignToQueue: 'snap-intake' }
  );

  // snap condition cannot match (no application resolved) — catch-all fires
  processRuleEvaluations([{ ruleType: 'assignment' }], task, rules, 'workflow');
  assert.strictEqual(task.queueId, 'q-general');
});

test('processRuleEvaluations — object-form binding skipped when from field is missing on resource', () => {
  clearAll('applications');
  clearAll('tasks');
  seedQueues();

  const task = { id: 'task-1', queueId: null }; // no subjectId

  const rules = makeRules(
    [
      'task.*',
      { as: 'application', entity: 'applications', from: 'task.subjectId' }
    ],
    { in: ['snap', { var: 'application.programs' }] },
    { assignToQueue: 'snap-intake' }
  );

  // snap condition cannot match — catch-all fires
  processRuleEvaluations([{ ruleType: 'assignment' }], task, rules, 'workflow');
  assert.strictEqual(task.queueId, 'q-general');
});

// =============================================================================
// String-form bindings still work (backwards compatibility)
// =============================================================================

test('processRuleEvaluations — string-form bindings continue to work unchanged', () => {
  clearAll('tasks');
  seedQueues();

  const task = { id: 'task-1', programType: 'snap', queueId: null };

  const rules = makeRules(
    ['task.*'],
    { '==': [{ var: 'task.programType' }, 'snap'] },
    { assignToQueue: 'snap-intake' }
  );

  processRuleEvaluations([{ ruleType: 'assignment' }], task, rules, 'workflow');
  assert.strictEqual(task.queueId, 'q-snap');
});

// =============================================================================
// Mixed bindings
// =============================================================================

test('processRuleEvaluations — mixed string and object bindings both contribute to context', () => {
  clearAll('applications');
  clearAll('tasks');
  seedQueues();

  insertResource('applications', { id: 'app-1', county: 'alameda' });
  const task = { id: 'task-1', subjectId: 'app-1', isExpedited: false, queueId: null };

  const rules = makeRules(
    [
      'task.*',
      { as: 'application', entity: 'applications', from: 'task.subjectId' }
    ],
    {
      and: [
        { '==': [{ var: 'task.isExpedited' }, false] },
        { '==': [{ var: 'application.county' }, 'alameda'] }
      ]
    },
    { assignToQueue: 'alameda-intake' }
  );

  processRuleEvaluations([{ ruleType: 'assignment' }], task, rules, 'workflow');
  assert.strictEqual(task.queueId, 'q-alameda');
});
