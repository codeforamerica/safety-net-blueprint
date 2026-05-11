/**
 * Unit tests for rule-evaluation — context binding and inline rule evaluation.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { insertResource, clearAll } from '../../src/database-manager.js';
import { processRuleEvaluations } from '../../src/handlers/rule-evaluation.js';

// =============================================================================
// Helpers
// =============================================================================

function makeContext(resource) {
  return {
    caller: { id: 'system', roles: ['system'] },
    object: { ...resource },
    request: {},
    now: new Date().toISOString()
  };
}

function makeInlineRule({ id = 'test-rule', evaluation = 'first-match-wins', context: ctx = [], conditions }) {
  return [{ id, evaluation, context: ctx, conditions }];
}

function seedQueues() {
  clearAll('queues');
  insertResource('queues', { id: 'q-snap', name: 'snap-intake' });
  insertResource('queues', { id: 'q-general', name: 'general-intake' });
  insertResource('queues', { id: 'q-alameda', name: 'alameda-intake' });
}

// =============================================================================
// Context binding — happy path
// =============================================================================

test('processRuleEvaluations — context binding resolves entity and makes fields available', () => {
  clearAll('applications');
  seedQueues();

  insertResource('applications', { id: 'app-1', programs: ['snap'] });
  const task = { id: 'task-1', subjectId: 'app-1', queueId: null };

  const inlineRules = makeInlineRule({
    context: [
      { application: { from: 'intake/applications', where: { id: '$object.subjectId' } } },
      { snapQueue: { from: 'workflow/queues', where: { name: 'snap-intake' }, optional: true } }
    ],
    conditions: [{
      id: 'snap-rule', order: 1,
      condition: { in: ['snap', { var: '$application.programs' }] },
      then: [{ set: { field: 'queueId', value: '$snapQueue.id' } }]
    }]
  });

  processRuleEvaluations([{ ruleId: 'test-rule' }], task, [], 'workflow', inlineRules, makeContext(task));
  assert.strictEqual(task.queueId, 'q-snap');
});

// =============================================================================
// Context binding — error: entity not found → skip rule set
// =============================================================================

test('processRuleEvaluations — entity not found skips rule set entirely', () => {
  clearAll('applications');
  seedQueues();

  const task = { id: 'task-1', subjectId: 'nonexistent', queueId: null };

  const inlineRules = makeInlineRule({
    context: [
      { application: { from: 'intake/applications', where: { id: '$object.subjectId' } } }
    ],
    conditions: [{
      id: 'snap-rule', order: 1,
      condition: { in: ['snap', { var: '$application.programs' }] },
      then: [{ set: { field: 'queueId', value: 'q-snap' } }]
    }]
  });

  processRuleEvaluations([{ ruleId: 'test-rule' }], task, [], 'workflow', inlineRules, makeContext(task));
  assert.strictEqual(task.queueId, null); // required binding failed — rule skipped
});

// =============================================================================
// Context binding — warning: from field missing → required binding fails, skip rule
// =============================================================================

test('processRuleEvaluations — missing from field value skips rule set entirely', () => {
  clearAll('applications');
  seedQueues();

  const task = { id: 'task-1', queueId: null }; // no subjectId

  const inlineRules = makeInlineRule({
    context: [
      { application: { from: 'intake/applications', where: { id: '$object.subjectId' } } }
    ],
    conditions: [{
      id: 'snap-rule', order: 1,
      condition: { in: ['snap', { var: '$application.programs' }] },
      then: [{ set: { field: 'queueId', value: 'q-snap' } }]
    }]
  });

  processRuleEvaluations([{ ruleId: 'test-rule' }], task, [], 'workflow', inlineRules, makeContext(task));
  assert.strictEqual(task.queueId, null); // required binding failed — rule skipped
});

// =============================================================================
// Optional bindings — resolution failure skips binding, not rule set
// =============================================================================

test('processRuleEvaluations — optional binding skipped when from field missing, rule set continues', () => {
  clearAll('applications');
  seedQueues();

  const task = { id: 'task-1', queueId: null }; // no subjectId

  const inlineRules = makeInlineRule({
    context: [
      { application: { from: 'intake/applications', where: { id: '$object.subjectId' }, optional: true } }
    ],
    conditions: [
      {
        id: 'snap-rule', order: 1,
        condition: { in: ['snap', { var: '$application.programs' }] },
        then: [{ set: { field: 'queueId', value: 'q-snap' } }]
      },
      {
        id: 'catch-all', order: 2,
        condition: true,
        then: [{ set: { field: 'queueId', value: 'q-general' } }]
      }
    ]
  });

  // binding skipped (optional) — snap condition fails (application null) — catch-all fires
  processRuleEvaluations([{ ruleId: 'test-rule' }], task, [], 'workflow', inlineRules, makeContext(task));
  assert.strictEqual(task.queueId, 'q-general');
});

test('processRuleEvaluations — optional binding skipped when entity not found, rule set continues', () => {
  clearAll('applications');
  seedQueues();

  const task = { id: 'task-1', subjectId: 'nonexistent', queueId: null };

  const inlineRules = makeInlineRule({
    context: [
      { application: { from: 'intake/applications', where: { id: '$object.subjectId' }, optional: true } }
    ],
    conditions: [
      {
        id: 'snap-rule', order: 1,
        condition: { in: ['snap', { var: '$application.programs' }] },
        then: [{ set: { field: 'queueId', value: 'q-snap' } }]
      },
      {
        id: 'catch-all', order: 2,
        condition: true,
        then: [{ set: { field: 'queueId', value: 'q-general' } }]
      }
    ]
  });

  // binding skipped (optional) — snap condition fails (application null) — catch-all fires
  processRuleEvaluations([{ ruleId: 'test-rule' }], task, [], 'workflow', inlineRules, makeContext(task));
  assert.strictEqual(task.queueId, 'q-general');
});

// =============================================================================
// Chaining — where clause references a previously resolved entity field
// =============================================================================

test('processRuleEvaluations — chained binding resolves entity via prior resolved entity field', () => {
  clearAll('applications');
  clearAll('cases');
  seedQueues();

  insertResource('applications', { id: 'app-1', programs: ['snap'], caseId: 'case-99' });
  insertResource('cases', { id: 'case-99', county: 'alameda' });
  const task = { id: 'task-1', subjectId: 'app-1', queueId: null };

  const inlineRules = makeInlineRule({
    context: [
      { application: { from: 'intake/applications', where: { id: '$object.subjectId' } } },
      { linkedCase: { from: 'case-management/cases', where: { id: '$application.caseId' } } }
    ],
    conditions: [{
      id: 'alameda-rule', order: 1,
      condition: { '==': [{ var: '$linkedCase.county' }, 'alameda'] },
      then: [{ set: { field: 'queueId', value: 'q-alameda' } }]
    }]
  });

  processRuleEvaluations([{ ruleId: 'test-rule' }], task, [], 'workflow', inlineRules, makeContext(task));
  assert.strictEqual(task.queueId, 'q-alameda');
});

// =============================================================================
// $object alias — calling resource fields accessible via $object.* in conditions
// =============================================================================

test('processRuleEvaluations — calling resource fields accessible as "$object.*" in conditions', () => {
  const task = { id: 'task-1', isExpedited: false, queueId: null };

  const inlineRules = makeInlineRule({
    conditions: [
      {
        id: 'expedited', order: 1,
        condition: { '==': [{ var: '$object.isExpedited' }, true] },
        then: [{ set: { field: 'queueId', value: 'q-snap' } }]
      },
      {
        id: 'catch-all', order: 2,
        condition: true,
        then: [{ set: { field: 'queueId', value: 'q-general' } }]
      }
    ]
  });

  processRuleEvaluations([{ ruleId: 'test-rule' }], task, [], 'workflow', inlineRules, makeContext(task));
  assert.strictEqual(task.queueId, 'q-general'); // isExpedited false → catch-all

  task.isExpedited = true;
  task.queueId = null;
  processRuleEvaluations([{ ruleId: 'test-rule' }], task, [], 'workflow', inlineRules, makeContext(task));
  assert.strictEqual(task.queueId, 'q-snap'); // isExpedited true → matches first condition
});

// =============================================================================
// Non-id where clause — entity looked up by arbitrary field
// =============================================================================

test('processRuleEvaluations — non-id where clause resolves entity by named field', () => {
  seedQueues();

  const task = { id: 'task-1', queueId: null };

  const inlineRules = makeInlineRule({
    context: [
      { snapQueue: { from: 'workflow/queues', where: { name: 'snap-intake' }, optional: true } }
    ],
    conditions: [{
      id: 'set-queue', order: 1,
      condition: true,
      then: [{ set: { field: 'queueId', value: '$snapQueue.id' } }]
    }]
  });

  processRuleEvaluations([{ ruleId: 'test-rule' }], task, [], 'workflow', inlineRules, makeContext(task));
  assert.strictEqual(task.queueId, 'q-snap');
});

// =============================================================================
// all-match evaluation — all matching conditions fire
// =============================================================================

test('processRuleEvaluations — all-match fires all matching conditions', () => {
  const task = { id: 'task-1', programs: ['snap', 'medicaid'], priority: null };

  const inlineRules = makeInlineRule({
    evaluation: 'all-match',
    conditions: [
      { id: 'snap-rule', order: 1, condition: { in: ['snap', { var: '$object.programs' }] }, then: [{ set: { field: 'priority', value: 'expedited' } }] },
      { id: 'medicaid-rule', order: 2, condition: { in: ['medicaid', { var: '$object.programs' }] }, then: [{ set: { field: 'priority', value: 'high' } }] }
    ]
  });

  processRuleEvaluations([{ ruleId: 'test-rule' }], task, [], 'workflow', inlineRules, makeContext(task));
  // Both conditions fired: expedited then high → final value is 'high'
  assert.strictEqual(task.priority, 'high');
});

test('processRuleEvaluations — first-match-wins stops at first matching condition', () => {
  const task = { id: 'task-1', programs: ['snap', 'medicaid'], priority: null };

  const inlineRules = makeInlineRule({
    evaluation: 'first-match-wins',
    conditions: [
      { id: 'snap-rule', order: 1, condition: { in: ['snap', { var: '$object.programs' }] }, then: [{ set: { field: 'priority', value: 'expedited' } }] },
      { id: 'medicaid-rule', order: 2, condition: { in: ['medicaid', { var: '$object.programs' }] }, then: [{ set: { field: 'priority', value: 'high' } }] }
    ]
  });

  processRuleEvaluations([{ ruleId: 'test-rule' }], task, [], 'workflow', inlineRules, makeContext(task));
  // Only snap-rule fired → 'expedited'
  assert.strictEqual(task.priority, 'expedited');
});
