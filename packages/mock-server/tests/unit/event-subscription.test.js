/**
 * Unit tests for event-subscription — event-triggered rule set evaluation.
 * Tests event type matching, context resolution from event envelope,
 * createResource action, and triggerTransition action.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { insertResource, clearAll, findAll, findById } from '../../src/database-manager.js';
import { registerEventSubscriptions } from '../../src/event-subscription.js';
import { eventBus } from '../../src/event-bus.js';

// Each test registers subscriptions; remove all listeners between tests to prevent accumulation
beforeEach(() => eventBus.removeAllListeners('domain-event'));

// =============================================================================
// Helpers
// =============================================================================

const SNAP_QUEUE_ID = 'q-snap-uuid';
const GENERAL_QUEUE_ID = 'q-general-uuid';

function seed() {
  clearAll('applications');
  clearAll('tasks');
  clearAll('queues');
  clearAll('events');
  insertResource('queues', { id: SNAP_QUEUE_ID, name: 'snap-intake' });
  insertResource('queues', { id: GENERAL_QUEUE_ID, name: 'general-intake' });
}

function makeEvent(type, subject, data = null) {
  return {
    specversion: '1.0',
    id: 'test-event-' + Math.random(),
    type,
    source: '/intake',
    subject,
    time: new Date().toISOString(),
    data
  };
}

// Minimal state machine for tasks
const taskStateMachine = {
  domain: 'workflow',
  object: 'task',
  initialState: 'pending',
  states: { pending: {}, in_progress: {}, completed: {} },
  transitions: [],
  guards: [],
  onCreate: {
    effects: [
      { type: 'evaluate-rules', ruleType: 'assignment' },
      { type: 'evaluate-rules', ruleType: 'priority' }
    ]
  }
};

// Minimal state machine for applications
const applicationStateMachine = {
  domain: 'intake',
  object: 'application',
  initialState: 'draft',
  states: { draft: {}, submitted: {}, under_review: {} },
  transitions: [
    {
      trigger: 'open',
      from: 'submitted',
      to: 'under_review',
      actors: ['system'],
      guards: ['callerIsSystem'],
      effects: [
        { type: 'event', action: 'opened', data: { openedAt: '$now' } }
      ]
    }
  ],
  guards: [
    {
      id: 'callerIsSystem',
      field: '$caller.roles',
      operator: 'contains_any',
      value: ['system']
    }
  ]
};

const allStateMachines = [
  { domain: 'workflow', object: 'task', stateMachine: taskStateMachine },
  { domain: 'intake', object: 'application', stateMachine: applicationStateMachine }
];

// =============================================================================
// Event type matching
// =============================================================================

test('registerEventSubscriptions — matches full CloudEvents type', (t, done) => {
  seed();
  clearAll('tasks');

  const APP_ID = 'app-full-type';
  insertResource('applications', { id: APP_ID, programs: ['snap'], status: 'submitted' });

  const rules = [{
    domain: 'workflow',
    resource: 'workflow/tasks',
    ruleSets: [{
      id: 'test-subscription',
      ruleType: 'task-creation',
      on: 'org.codeforamerica.safety-net-blueprint.intake.application.submitted',
      evaluation: 'first-match-wins',
      rules: [{ id: 'r1', order: 1, condition: true, action: { createResource: { entity: 'workflow/tasks', fields: { name: 'Test task', status: 'pending', subjectId: { var: 'this.subject' } } } } }]
    }]
  }];

  registerEventSubscriptions(rules, allStateMachines);

  eventBus.emit('domain-event', makeEvent(
    'org.codeforamerica.safety-net-blueprint.intake.application.submitted',
    APP_ID
  ));

  setImmediate(() => {
    const { items } = findAll('tasks', { subjectId: APP_ID });
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].status, 'pending');
    done();
  });
});

test('registerEventSubscriptions — matches short-form type', (t, done) => {
  seed();

  const APP_ID = 'app-short-type';
  insertResource('applications', { id: APP_ID, programs: ['snap'], status: 'submitted' });

  const rules = [{
    domain: 'workflow',
    resource: 'workflow/tasks',
    ruleSets: [{
      id: 'test-short-form',
      ruleType: 'task-creation',
      on: 'intake.application.submitted',
      evaluation: 'first-match-wins',
      rules: [{ id: 'r1', order: 1, condition: true, action: { createResource: { entity: 'workflow/tasks', fields: { name: 'Short form task', status: 'pending', subjectId: { var: 'this.subject' } } } } }]
    }]
  }];

  registerEventSubscriptions(rules, allStateMachines);

  eventBus.emit('domain-event', makeEvent(
    'org.codeforamerica.safety-net-blueprint.intake.application.submitted',
    APP_ID
  ));

  setImmediate(() => {
    const { items } = findAll('tasks', { subjectId: APP_ID });
    assert.strictEqual(items.length, 1);
    done();
  });
});

test('registerEventSubscriptions — non-matching event type does not fire', (t, done) => {
  seed();

  const APP_ID = 'app-no-match';

  const rules = [{
    domain: 'workflow',
    resource: 'workflow/tasks',
    ruleSets: [{
      id: 'test-no-match',
      ruleType: 'task-creation',
      on: 'intake.application.submitted',
      evaluation: 'first-match-wins',
      rules: [{ id: 'r1', order: 1, condition: true, action: { createResource: { entity: 'workflow/tasks', fields: { name: 'Should not exist', status: 'pending', subjectId: APP_ID } } } }]
    }]
  }];

  registerEventSubscriptions(rules, allStateMachines);

  eventBus.emit('domain-event', makeEvent(
    'org.codeforamerica.safety-net-blueprint.intake.application.created',
    APP_ID
  ));

  setImmediate(() => {
    const { items } = findAll('tasks', { subjectId: APP_ID });
    assert.strictEqual(items.length, 0);
    done();
  });
});

// =============================================================================
// createResource — context resolution and JSON Logic field values
// =============================================================================

test('createResource — resolves context binding from event envelope subject', (t, done) => {
  seed();

  const APP_ID = 'app-ctx-resolve';
  insertResource('applications', { id: APP_ID, programs: ['snap'], status: 'submitted' });

  const rules = [{
    domain: 'workflow',
    resource: 'workflow/tasks',
    ruleSets: [{
      id: 'test-ctx',
      ruleType: 'task-creation',
      on: 'intake.application.submitted',
      evaluation: 'first-match-wins',
      context: [{ as: 'application', entity: 'intake/applications', from: 'subject' }],
      rules: [{
        id: 'r1',
        order: 1,
        condition: { in: ['snap', { var: 'application.programs' }] },
        action: {
          createResource: {
            entity: 'workflow/tasks',
            fields: {
              name: 'SNAP task',
              status: 'pending',
              subjectId: { var: 'this.subject' },
              taskType: 'application_review'
            }
          }
        }
      }]
    }],
    // Assignment rules for routing
    ...[{
      domain: 'workflow',
      resource: 'workflow/tasks',
      ruleSets: [{
        id: 'workflow-assignment',
        ruleType: 'assignment',
        evaluation: 'first-match-wins',
        context: [{ as: 'application', entity: 'intake/applications', from: 'subjectId', optional: true }],
        rules: [
          { id: 'snap', order: 1, condition: { in: ['snap', { var: 'application.programs' }] }, action: { assignToQueue: 'snap-intake' }, fallbackAction: { assignToQueue: 'general-intake' } },
          { id: 'default', order: 2, condition: true, action: { assignToQueue: 'general-intake' } }
        ]
      }]
    }]
  }];

  // Build flat rules array
  const allRules = [
    {
      domain: 'workflow',
      resource: 'workflow/tasks',
      ruleSets: [
        {
          id: 'test-ctx',
          ruleType: 'task-creation',
          on: 'intake.application.submitted',
          evaluation: 'first-match-wins',
          context: [{ as: 'application', entity: 'intake/applications', from: 'subject' }],
          rules: [{
            id: 'r1',
            order: 1,
            condition: { in: ['snap', { var: 'application.programs' }] },
            action: {
              createResource: {
                entity: 'workflow/tasks',
                fields: {
                  name: 'SNAP task',
                  status: 'pending',
                  subjectId: { var: 'this.subject' },
                  taskType: 'application_review'
                }
              }
            }
          }]
        },
        {
          id: 'workflow-assignment',
          ruleType: 'assignment',
          evaluation: 'first-match-wins',
          context: [{ as: 'application', entity: 'intake/applications', from: 'subjectId', optional: true }],
          rules: [
            { id: 'snap', order: 1, condition: { in: ['snap', { var: 'application.programs' }] }, action: { assignToQueue: 'snap-intake' }, fallbackAction: { assignToQueue: 'general-intake' } },
            { id: 'default', order: 2, condition: true, action: { assignToQueue: 'general-intake' } }
          ]
        }
      ]
    }
  ];

  registerEventSubscriptions(allRules, allStateMachines);

  eventBus.emit('domain-event', makeEvent(
    'org.codeforamerica.safety-net-blueprint.intake.application.submitted',
    APP_ID
  ));

  setImmediate(() => {
    const { items } = findAll('tasks', { subjectId: APP_ID });
    assert.strictEqual(items.length, 1, 'task created');
    assert.strictEqual(items[0].taskType, 'application_review');
    assert.strictEqual(items[0].status, 'pending');
    assert.strictEqual(items[0].queueId, SNAP_QUEUE_ID, 'routed to snap-intake via assignment rules');
    done();
  });
});

// =============================================================================
// triggerTransition — via context binding chain
// =============================================================================

test('triggerTransition — transitions a related entity to new state', (t, done) => {
  seed();

  const APP_ID = 'app-trigger-test';
  const TASK_ID = 'task-trigger-test';
  insertResource('applications', { id: APP_ID, status: 'submitted' });
  insertResource('tasks', { id: TASK_ID, subjectId: APP_ID, subjectType: 'application', taskType: 'application_review', status: 'in_progress' });

  const allRules = [{
    domain: 'intake',
    resource: 'intake/applications',
    ruleSets: [{
      id: 'task-claimed-open-application',
      ruleType: 'status-transition',
      on: 'workflow.task.claimed',
      evaluation: 'first-match-wins',
      context: [
        { as: 'task', entity: 'workflow/tasks', from: 'subject' },
        { as: 'application', entity: 'intake/applications', from: 'task.subjectId', optional: true }
      ],
      rules: [{
        id: 'open-on-claim',
        order: 1,
        condition: {
          and: [
            { '!=': [{ var: 'application.id' }, null] },
            { '==': [{ var: 'task.taskType' }, 'application_review'] },
            { '==': [{ var: 'application.status' }, 'submitted'] }
          ]
        },
        action: {
          triggerTransition: {
            entity: 'intake/applications',
            idFrom: 'application.id',
            transition: 'open'
          }
        }
      }]
    }]
  }];

  registerEventSubscriptions(allRules, allStateMachines);

  eventBus.emit('domain-event', makeEvent(
    'org.codeforamerica.safety-net-blueprint.workflow.task.claimed',
    TASK_ID
  ));

  setImmediate(() => {
    const app = findById('applications', APP_ID);
    assert.strictEqual(app.status, 'under_review', 'application transitioned to under_review');
    done();
  });
});

test('triggerTransition — skips when application not in submitted state', (t, done) => {
  seed();

  const APP_ID = 'app-already-under-review';
  const TASK_ID = 'task-already-under-review';
  insertResource('applications', { id: APP_ID, status: 'under_review' });
  insertResource('tasks', { id: TASK_ID, subjectId: APP_ID, subjectType: 'application', taskType: 'application_review', status: 'in_progress' });

  const allRules = [{
    domain: 'intake',
    resource: 'intake/applications',
    ruleSets: [{
      id: 'task-claimed-open-application',
      ruleType: 'status-transition',
      on: 'workflow.task.claimed',
      evaluation: 'first-match-wins',
      context: [
        { as: 'task', entity: 'workflow/tasks', from: 'subject' },
        { as: 'application', entity: 'intake/applications', from: 'task.subjectId', optional: true }
      ],
      rules: [{
        id: 'open-on-claim',
        order: 1,
        condition: {
          and: [
            { '!=': [{ var: 'application.id' }, null] },
            { '==': [{ var: 'task.taskType' }, 'application_review'] },
            { '==': [{ var: 'application.status' }, 'submitted'] }
          ]
        },
        action: {
          triggerTransition: {
            entity: 'intake/applications',
            idFrom: 'application.id',
            transition: 'open'
          }
        }
      }]
    }]
  }];

  registerEventSubscriptions(allRules, allStateMachines);

  eventBus.emit('domain-event', makeEvent(
    'org.codeforamerica.safety-net-blueprint.workflow.task.claimed',
    TASK_ID
  ));

  setImmediate(() => {
    const app = findById('applications', APP_ID);
    // Status should be unchanged — condition required submitted, got under_review
    assert.strictEqual(app.status, 'under_review');
    done();
  });
});
