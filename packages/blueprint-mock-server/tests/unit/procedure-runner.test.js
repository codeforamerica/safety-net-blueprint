/**
 * Unit tests for procedure-runner — context binding and inline procedure evaluation.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { createMemoryStore } from '../../src/stores/memory-store.js';

// A store of this file's own, rather than one shared through a module-level
// singleton. In memory because these cases do not need a database — and
// because a fresh one per file is isolation they did not have before.
const store = createMemoryStore();
import { executeProcedures } from '../../src/handlers/procedure-runner.js';

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

function makeInlineRule({ id = 'test-rule', context: ctx = [], steps }) {
  return [{ id, context: ctx, steps }];
}

function seedQueues() {
  store.clearAll('workflow/queues');
  store.insertResource('workflow/queues', { id: 'q-snap', name: 'snap-intake' });
  store.insertResource('workflow/queues', { id: 'q-general', name: 'general-intake' });
  store.insertResource('workflow/queues', { id: 'q-alameda', name: 'alameda-intake' });
}

// =============================================================================
// Context binding — happy path
// =============================================================================

test('executeProcedures — context binding resolves entity and makes fields available', () => {
  store.clearAll('intake/applications');
  seedQueues();

  store.insertResource('intake/applications', { id: 'app-1', programs: ['snap'] });
  const task = { id: 'task-1', subjectId: 'app-1', queueId: null };

  const inlineRules = makeInlineRule({
    context: [
      { application: { from: 'intake/applications', where: { id: '$object.subjectId' } } },
      { snapQueue: { from: 'workflow/queues', where: { name: 'snap-intake' }, optional: true } }
    ],
    steps: [{
      if: '"snap" in application.programs',
      then: [{ set: { field: 'queueId', value: '$snapQueue.id' } }]
    }]
  });

  executeProcedures([{ procedureId: 'test-rule' }], task, inlineRules, makeContext(task), store);
  assert.strictEqual(task.queueId, 'q-snap');
});

// =============================================================================
// Context binding — error: entity not found → skip rule set
// =============================================================================

test('executeProcedures — entity not found skips rule set entirely', () => {
  store.clearAll('intake/applications');
  seedQueues();

  const task = { id: 'task-1', subjectId: 'nonexistent', queueId: null };

  const inlineRules = makeInlineRule({
    context: [
      { application: { from: 'intake/applications', where: { id: '$object.subjectId' } } }
    ],
    steps: [{
      if: '"snap" in application.programs',
      then: [{ set: { field: 'queueId', value: 'q-snap' } }]
    }]
  });

  executeProcedures([{ procedureId: 'test-rule' }], task, inlineRules, makeContext(task), store);
  assert.strictEqual(task.queueId, null); // required binding failed — rule skipped
});

// =============================================================================
// Context binding — warning: from field missing → required binding fails, skip rule
// =============================================================================

test('executeProcedures — missing from field value skips rule set entirely', () => {
  store.clearAll('intake/applications');
  seedQueues();

  const task = { id: 'task-1', queueId: null }; // no subjectId

  const inlineRules = makeInlineRule({
    context: [
      { application: { from: 'intake/applications', where: { id: '$object.subjectId' } } }
    ],
    steps: [{
      if: '"snap" in application.programs',
      then: [{ set: { field: 'queueId', value: 'q-snap' } }]
    }]
  });

  executeProcedures([{ procedureId: 'test-rule' }], task, inlineRules, makeContext(task), store);
  assert.strictEqual(task.queueId, null); // required binding failed — rule skipped
});

// =============================================================================
// Optional bindings — resolution failure skips binding, not rule set
// =============================================================================

test('executeProcedures — optional binding skipped when from field missing, rule set continues', () => {
  store.clearAll('intake/applications');
  seedQueues();

  const task = { id: 'task-1', queueId: null }; // no subjectId

  const inlineRules = makeInlineRule({
    context: [
      { application: { from: 'intake/applications', where: { id: '$object.subjectId' }, optional: true } }
    ],
    steps: [{
      if: 'application != null && "snap" in application.programs',
      then: [{ set: { field: 'queueId', value: 'q-snap' } }],
      else: [{ set: { field: 'queueId', value: 'q-general' } }]
    }]
  });

  // binding skipped (optional) — application is null, so the else branch runs
  executeProcedures([{ procedureId: 'test-rule' }], task, inlineRules, makeContext(task), store);
  assert.strictEqual(task.queueId, 'q-general');
});

test('executeProcedures — optional binding skipped when entity not found, rule set continues', () => {
  store.clearAll('intake/applications');
  seedQueues();

  const task = { id: 'task-1', subjectId: 'nonexistent', queueId: null };

  const inlineRules = makeInlineRule({
    context: [
      { application: { from: 'intake/applications', where: { id: '$object.subjectId' }, optional: true } }
    ],
    steps: [{
      if: 'application != null && "snap" in application.programs',
      then: [{ set: { field: 'queueId', value: 'q-snap' } }],
      else: [{ set: { field: 'queueId', value: 'q-general' } }]
    }]
  });

  // binding skipped (optional) — application is null, so the else branch runs
  executeProcedures([{ procedureId: 'test-rule' }], task, inlineRules, makeContext(task), store);
  assert.strictEqual(task.queueId, 'q-general');
});

// =============================================================================
// Chaining — where clause references a previously resolved entity field
// =============================================================================

test('executeProcedures — chained binding resolves entity via prior resolved entity field', () => {
  store.clearAll('intake/applications');
  store.clearAll('case-management/cases');
  seedQueues();

  store.insertResource('intake/applications', { id: 'app-1', programs: ['snap'], caseId: 'case-99' });
  store.insertResource('case-management/cases', { id: 'case-99', county: 'alameda' });
  const task = { id: 'task-1', subjectId: 'app-1', queueId: null };

  const inlineRules = makeInlineRule({
    context: [
      { application: { from: 'intake/applications', where: { id: '$object.subjectId' } } },
      { linkedCase: { from: 'case-management/cases', where: { id: '$application.caseId' } } }
    ],
    steps: [{
      if: 'linkedCase.county == "alameda"',
      then: [{ set: { field: 'queueId', value: 'q-alameda' } }]
    }]
  });

  executeProcedures([{ procedureId: 'test-rule' }], task, inlineRules, makeContext(task), store);
  assert.strictEqual(task.queueId, 'q-alameda');
});

// =============================================================================
// object — the calling resource's fields, read as object.* in conditions
// =============================================================================

test('executeProcedures — calling resource fields readable as "object.*" in conditions', () => {
  const task = { id: 'task-1', isExpedited: false, queueId: null };

  const inlineRules = makeInlineRule({
    steps: [{
      if: 'object.isExpedited == true',
      then: [{ set: { field: 'queueId', value: 'q-snap' } }],
      else: [{ set: { field: 'queueId', value: 'q-general' } }]
    }]
  });

  executeProcedures([{ procedureId: 'test-rule' }], task, inlineRules, makeContext(task), store);
  assert.strictEqual(task.queueId, 'q-general'); // isExpedited false → else branch

  task.isExpedited = true;
  task.queueId = null;
  executeProcedures([{ procedureId: 'test-rule' }], task, inlineRules, makeContext(task), store);
  assert.strictEqual(task.queueId, 'q-snap'); // isExpedited true → then branch
});

// =============================================================================
// Non-id where clause — entity looked up by arbitrary field
// =============================================================================

test('executeProcedures — non-id where clause resolves entity by named field', () => {
  seedQueues();

  const task = { id: 'task-1', queueId: null };

  const inlineRules = makeInlineRule({
    context: [
      { snapQueue: { from: 'workflow/queues', where: { name: 'snap-intake' }, optional: true } }
    ],
    steps: [{ set: { field: 'queueId', value: '$snapQueue.id' } }]
  });

  executeProcedures([{ procedureId: 'test-rule' }], task, inlineRules, makeContext(task), store);
  assert.strictEqual(task.queueId, 'q-snap');
});

// =============================================================================
// Context binding — CEL where
// =============================================================================

test('executeProcedures — CEL where in context binding returns first match', () => {
  store.clearAll('workflow/queues');
  store.insertResource('workflow/queues', { id: 'q-snap', name: 'snap-intake', priority: 1 });
  store.insertResource('workflow/queues', { id: 'q-general', name: 'general-intake', priority: 2 });

  const task = { id: 'task-1', queueId: null };

  const inlineRules = makeInlineRule({
    context: [{
      snapQueue: {
        from: 'workflow/queues',
        where: 'item.name == "snap-intake"'
      }
    }],
    steps: [{ set: { field: 'queueId', value: '$snapQueue.id' } }]
  });

  executeProcedures([{ procedureId: 'test-rule' }], task, inlineRules, makeContext(task), store);
  assert.strictEqual(task.queueId, 'q-snap');
});

// =============================================================================
// Rule-level context — local additions inherit call-site scope
// =============================================================================

test('executeProcedures — rule-level context adds bindings not in caller scope', () => {
  store.clearAll('intake/applications');
  store.clearAll('workflow/queues');
  store.insertResource('intake/applications', { id: 'app-1', programs: ['snap'] });
  store.insertResource('workflow/queues', { id: 'q-snap', name: 'snap-intake' });

  // Rule has its own context: (application binding) not provided by caller
  const task = { id: 'task-1', subjectId: 'app-1', queueId: null };
  const inlineRules = makeInlineRule({
    context: [{
      application: { from: 'intake/applications', where: { id: '$object.subjectId' } }
    }],
    steps: [{
      if: '"snap" in application.programs',
      then: [{ set: { field: 'queueId', value: 'q-snap' } }]
    }]
  });

  // Call-site context has no entities — the rule resolves its own
  executeProcedures([{ procedureId: 'test-rule' }], task, inlineRules, makeContext(task), store);
  assert.strictEqual(task.queueId, 'q-snap');
});

test('executeProcedures — rule-level context can chain from caller-scope entities', () => {
  store.clearAll('intake/applications');
  store.clearAll('workflow/queues');
  store.insertResource('intake/applications', { id: 'app-1', programs: ['snap'], countyQueueName: 'snap-intake' });
  store.insertResource('workflow/queues', { id: 'q-snap', name: 'snap-intake' });

  const task = { id: 'task-1', subjectId: 'app-1', queueId: null };

  // Rule context: queue binding uses application (provided by call-site scope) to resolve name
  const inlineRules = makeInlineRule({
    context: [
      { application: { from: 'intake/applications', where: { id: '$object.subjectId' } } },
      { targetQueue: { from: 'workflow/queues', where: { name: '$application.countyQueueName' } } }
    ],
    steps: [{ set: { field: 'queueId', value: '$targetQueue.id' } }]
  });

  executeProcedures([{ procedureId: 'test-rule' }], task, inlineRules, makeContext(task), store);
  assert.strictEqual(task.queueId, 'q-snap');
});
