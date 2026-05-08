/**
 * Unit tests for rule-evaluation — specifically the context enrichment path
 * (resolveContextEntities + processRuleEvaluations with per-ruleSet context bindings).
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { insertResource, clearAll } from '../../src/database-manager.js';
import { processRuleEvaluations, resolveContextEntities } from '../../src/handlers/rule-evaluation.js';

// =============================================================================
// Helpers
// =============================================================================

function makeRules(contextBindings, condition, action) {
  return [
    {
      domain: 'workflow',
      ruleSets: [
        {
          id: 'test-ruleset',
          ruleType: 'assignment',
          evaluation: 'first-match-wins',
          context: contextBindings,
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
// Context binding — happy path
// =============================================================================

test('processRuleEvaluations — context binding resolves entity and makes fields available', () => {
  clearAll('applications');
  clearAll('tasks');
  seedQueues();

  insertResource('applications', { id: 'app-1', programs: ['snap'] });
  const task = { id: 'task-1', subjectId: 'app-1', queueId: null };

  const rules = makeRules(
    [{ as: 'application', entity: 'intake/applications', from: 'subjectId' }],
    { in: ['snap', { var: 'application.programs' }] },
    { assignToQueue: 'snap-intake' }
  );

  processRuleEvaluations([{ ruleType: 'assignment' }], task, rules, 'workflow');
  assert.strictEqual(task.queueId, 'q-snap');
});

// =============================================================================
// Context binding — error: entity not found → skip rule set
// =============================================================================

test('processRuleEvaluations — entity not found skips rule set entirely', () => {
  clearAll('applications');
  clearAll('tasks');
  seedQueues();

  // Application with this ID does not exist in the DB
  const task = { id: 'task-1', subjectId: 'nonexistent', queueId: null };

  const rules = makeRules(
    [{ as: 'application', entity: 'intake/applications', from: 'subjectId' }],
    { in: ['snap', { var: 'application.programs' }] },
    { assignToQueue: 'snap-intake' }
  );

  // Rule set skipped — queueId stays null (no fallback fires)
  processRuleEvaluations([{ ruleType: 'assignment' }], task, rules, 'workflow');
  assert.strictEqual(task.queueId, null);
});

// =============================================================================
// Context binding — warning: from field missing → skip binding, rule set continues
// =============================================================================

test('processRuleEvaluations — missing from field value skips rule set entirely', () => {
  clearAll('applications');
  clearAll('tasks');
  seedQueues();

  const task = { id: 'task-1', queueId: null }; // no subjectId

  const rules = makeRules(
    [{ as: 'application', entity: 'intake/applications', from: 'subjectId' }],
    { in: ['snap', { var: 'application.programs' }] },
    { assignToQueue: 'snap-intake' }
  );

  // from path resolves to no value — error — rule set skipped — queueId stays null
  processRuleEvaluations([{ ruleType: 'assignment' }], task, rules, 'workflow');
  assert.strictEqual(task.queueId, null);
});

// =============================================================================
// Optional bindings — resolution failure skips binding, not rule set
// =============================================================================

test('processRuleEvaluations — optional binding skipped when from field missing, rule set continues', () => {
  clearAll('applications');
  clearAll('tasks');
  seedQueues();

  const task = { id: 'task-1', queueId: null }; // no subjectId

  const rules = makeRules(
    [{ as: 'application', entity: 'intake/applications', from: 'subjectId', optional: true }],
    { in: ['snap', { var: 'application.programs' }] },
    { assignToQueue: 'snap-intake' }
  );

  // binding skipped (optional) — snap condition fails (no application) — catch-all fires
  processRuleEvaluations([{ ruleType: 'assignment' }], task, rules, 'workflow');
  assert.strictEqual(task.queueId, 'q-general');
});

test('processRuleEvaluations — optional binding skipped when entity not found, rule set continues', () => {
  clearAll('applications');
  clearAll('tasks');
  seedQueues();

  const task = { id: 'task-1', subjectId: 'nonexistent', queueId: null };

  const rules = makeRules(
    [{ as: 'application', entity: 'intake/applications', from: 'subjectId', optional: true }],
    { in: ['snap', { var: 'application.programs' }] },
    { assignToQueue: 'snap-intake' }
  );

  // binding skipped (optional) — snap condition fails (no application) — catch-all fires
  processRuleEvaluations([{ ruleType: 'assignment' }], task, rules, 'workflow');
  assert.strictEqual(task.queueId, 'q-general');
});

// =============================================================================
// Chaining — from path references a previously resolved entity
// =============================================================================

test('processRuleEvaluations — chained binding resolves entity via prior resolved entity field', () => {
  clearAll('applications');
  clearAll('cases');
  clearAll('tasks');
  seedQueues();

  insertResource('applications', { id: 'app-1', programs: ['snap'], caseId: 'case-99' });
  insertResource('cases', { id: 'case-99', county: 'alameda' });
  const task = { id: 'task-1', subjectId: 'app-1', queueId: null };

  const rules = makeRules(
    [
      { as: 'application', entity: 'intake/applications', from: 'subjectId' },
      { as: 'case', entity: 'case-management/cases', from: 'application.caseId' }
    ],
    { '==': [{ var: 'case.county' }, 'alameda'] },
    { assignToQueue: 'alameda-intake' }
  );

  processRuleEvaluations([{ ruleType: 'assignment' }], task, rules, 'workflow');
  assert.strictEqual(task.queueId, 'q-alameda');
});

// =============================================================================
// "this" alias — calling resource fields accessible via this.*
// =============================================================================

test('processRuleEvaluations — calling resource fields accessible as "this.*" in conditions', () => {
  clearAll('tasks');
  seedQueues();

  const task = { id: 'task-1', isExpedited: false, queueId: null };

  const rules = [
    {
      domain: 'workflow',
      ruleSets: [
        {
          id: 'test-priority',
          ruleType: 'assignment',
          evaluation: 'first-match-wins',
          rules: [
            {
              id: 'expedited',
              order: 1,
              condition: { '==': [{ var: 'this.isExpedited' }, true] },
              action: { assignToQueue: 'snap-intake' }
            },
            { id: 'catch-all', order: 2, condition: true, action: { assignToQueue: 'general-intake' } }
          ]
        }
      ]
    }
  ];

  processRuleEvaluations([{ ruleType: 'assignment' }], task, rules, 'workflow');
  assert.strictEqual(task.queueId, 'q-general'); // isExpedited false → catch-all

  task.isExpedited = true;
  task.queueId = null;
  processRuleEvaluations([{ ruleType: 'assignment' }], task, rules, 'workflow');
  assert.strictEqual(task.queueId, 'q-snap'); // isExpedited true → snap-intake
});

// =============================================================================
// JSON Logic from: form — {var: "path"} accepted alongside bare string
// =============================================================================

test('processRuleEvaluations — JSON Logic {var: "..."} from: resolves entity correctly', () => {
  clearAll('applications');
  clearAll('tasks');
  seedQueues();

  insertResource('applications', { id: 'app-1', programs: ['snap'] });
  const task = { id: 'task-1', subjectId: 'app-1', queueId: null };

  const rules = makeRules(
    [{ as: 'application', entity: 'intake/applications', from: { var: 'subjectId' } }],
    { in: ['snap', { var: 'application.programs' }] },
    { assignToQueue: 'snap-intake' }
  );

  processRuleEvaluations([{ ruleType: 'assignment' }], task, rules, 'workflow');
  assert.strictEqual(task.queueId, 'q-snap');
});

// =============================================================================
// Collection binding — entity absent, from resolves to a value bound directly
// =============================================================================

test('processRuleEvaluations — collection binding binds array value without entity lookup', () => {
  clearAll('tasks');
  seedQueues();

  // members is an embedded array on the task — no separate entity to fetch
  const task = {
    id: 'task-1',
    members: [{ id: 'm-1', programs: ['snap'] }, { id: 'm-2', programs: ['medicaid'] }],
    queueId: null
  };

  const rules = [
    {
      domain: 'workflow',
      ruleSets: [
        {
          id: 'test-collection-binding',
          ruleType: 'assignment',
          evaluation: 'first-match-wins',
          context: [{ as: 'members', from: { var: 'members' } }],
          rules: [
            {
              id: 'has-snap-member',
              order: 1,
              condition: { some: [{ var: 'members' }, { in: ['snap', { var: 'programs' }] }] },
              action: { assignToQueue: 'snap-intake' }
            },
            { id: 'catch-all', order: 2, condition: true, action: { assignToQueue: 'general-intake' } }
          ]
        }
      ]
    }
  ];

  processRuleEvaluations([{ ruleType: 'assignment' }], task, rules, 'workflow');
  assert.strictEqual(task.queueId, 'q-snap');
});

// =============================================================================
// Collection query binding — where clause fetches and filters collection
// =============================================================================

test('resolveContextEntities — where binding fetches entities matching JSON Logic filter', () => {
  clearAll('application-members');

  insertResource('application-members', { id: 'm-1', applicationId: 'app-1' });
  insertResource('application-members', { id: 'm-2', applicationId: 'app-1' });
  insertResource('application-members', { id: 'm-3', applicationId: 'app-99' }); // different app — excluded

  // application.id is in the resource so the where expression can reference it
  const resource = { application: { id: 'app-1' } };

  const bindings = [
    {
      as: 'members',
      entity: 'intake/application-members',
      where: { '==': [{ var: 'applicationId' }, { var: 'application.id' }] }
    }
  ];

  const result = resolveContextEntities(bindings, resource);
  assert.ok(result !== null);
  assert.strictEqual(result.members.length, 2);
  assert.ok(result.members.some(m => m.id === 'm-1'));
  assert.ok(result.members.some(m => m.id === 'm-2'));
  assert.ok(!result.members.some(m => m.id === 'm-3'));
});

test('resolveContextEntities — where binding returns empty array when no entities match', () => {
  clearAll('application-members');
  // No members for app-1

  const resource = { application: { id: 'app-1' } };

  const bindings = [
    {
      as: 'members',
      entity: 'intake/application-members',
      where: { '==': [{ var: 'applicationId' }, { var: 'application.id' }] }
    }
  ];

  const result = resolveContextEntities(bindings, resource);
  assert.ok(result !== null); // empty result is not an error
  assert.deepStrictEqual(result.members, []);
});

test('resolveContextEntities — where binding filter uses compound JSON Logic expression', () => {
  clearAll('application-members');

  insertResource('application-members', { id: 'm-1', applicationId: 'app-1', citizenshipStatus: 'citizen' });
  insertResource('application-members', { id: 'm-2', applicationId: 'app-1', citizenshipStatus: 'permanent_resident' });
  insertResource('application-members', { id: 'm-3', applicationId: 'app-1', citizenshipStatus: 'undocumented' });

  const resource = { application: { id: 'app-1' } };

  const bindings = [
    {
      as: 'nonCitizens',
      entity: 'intake/application-members',
      where: {
        and: [
          { '==': [{ var: 'applicationId' }, { var: 'application.id' }] },
          { '!=': [{ var: 'citizenshipStatus' }, 'citizen'] }
        ]
      }
    }
  ];

  const result = resolveContextEntities(bindings, resource);
  assert.ok(result !== null);
  assert.strictEqual(result.nonCitizens.length, 2);
  assert.ok(result.nonCitizens.every(m => m.citizenshipStatus !== 'citizen'));
  assert.ok(result.nonCitizens.some(m => m.id === 'm-2'));
  assert.ok(result.nonCitizens.some(m => m.id === 'm-3'));
});

// =============================================================================
// all-match evaluation — all matching rules fire
// =============================================================================

test('processRuleEvaluations — all-match fires all matching rules', () => {
  clearAll('tasks');

  // Both snap and medicaid rules match. With all-match, both fire in order —
  // rule 2 overwrites rule 1 so final priority is 'high'.
  const task = { id: 'task-1', programs: ['snap', 'medicaid'], priority: null };

  const rules = [
    {
      domain: 'workflow',
      ruleSets: [
        {
          id: 'test-all-match',
          ruleType: 'priority',
          evaluation: 'all-match',
          rules: [
            { id: 'snap-rule', order: 1, condition: { in: ['snap', { var: 'this.programs' }] }, action: { setPriority: 'expedited' } },
            { id: 'medicaid-rule', order: 2, condition: { in: ['medicaid', { var: 'this.programs' }] }, action: { setPriority: 'high' } }
          ]
        }
      ]
    }
  ];

  processRuleEvaluations([{ ruleType: 'priority' }], task, rules, 'workflow');
  // Both rules fired: expedited then high → final value is 'high'
  assert.strictEqual(task.priority, 'high');
});

test('processRuleEvaluations — first-match-wins stops at first matching rule', () => {
  clearAll('tasks');

  // Same rules as above, but first-match-wins: only rule 1 fires → 'expedited'
  const task = { id: 'task-1', programs: ['snap', 'medicaid'], priority: null };

  const rules = [
    {
      domain: 'workflow',
      ruleSets: [
        {
          id: 'test-first-match',
          ruleType: 'priority',
          evaluation: 'first-match-wins',
          rules: [
            { id: 'snap-rule', order: 1, condition: { in: ['snap', { var: 'this.programs' }] }, action: { setPriority: 'expedited' } },
            { id: 'medicaid-rule', order: 2, condition: { in: ['medicaid', { var: 'this.programs' }] }, action: { setPriority: 'high' } }
          ]
        }
      ]
    }
  ];

  processRuleEvaluations([{ ruleType: 'priority' }], task, rules, 'workflow');
  // Only snap-rule fired → 'expedited'
  assert.strictEqual(task.priority, 'expedited');
});
