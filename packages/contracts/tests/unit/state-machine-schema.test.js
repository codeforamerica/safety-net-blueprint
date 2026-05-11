/**
 * Unit tests for the state machine schema.
 * Validates structural correctness by running real YAML files and inline
 * fixtures through the JSON Schema.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import Ajv2020 from 'ajv/dist/2020.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsRoot = join(__dirname, '../../');
const schemaPath = join(contractsRoot, 'schemas/state-machine-schema.yaml');

function loadSchema() {
  const raw = readFileSync(schemaPath, 'utf8');
  return yaml.load(raw);
}

function makeValidator() {
  const schema = loadSchema();
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  return ajv.compile(schema);
}

function validate(doc) {
  const { $schema, ...data } = doc;
  const validate = makeValidator();
  const valid = validate(data);
  return { valid, errors: validate.errors || [] };
}

function errorPaths(errors) {
  return errors.map(e => `${e.instancePath || '(root)'}: ${e.message}`);
}

// ---------------------------------------------------------------------------
// Real file round-trips
// ---------------------------------------------------------------------------

test('state-machine-schema validates real files', async (t) => {

  await t.test('workflow-state-machine.yaml is valid', () => {
    const doc = yaml.load(readFileSync(join(contractsRoot, 'workflow-state-machine.yaml'), 'utf8'));
    const { valid, errors } = validate(doc);
    assert.ok(valid, `Expected valid but got errors:\n${errorPaths(errors).join('\n')}`);
  });

  await t.test('intake-state-machine.yaml is valid', () => {
    const doc = yaml.load(readFileSync(join(contractsRoot, 'intake-state-machine.yaml'), 'utf8'));
    const { valid, errors } = validate(doc);
    assert.ok(valid, `Expected valid but got errors:\n${errorPaths(errors).join('\n')}`);
  });

});

// ---------------------------------------------------------------------------
// Structural requirements
// ---------------------------------------------------------------------------

test('state-machine-schema structural requirements', async (t) => {

  const base = {
    version: '1.0',
    domain: 'test',
    apiSpec: 'test-openapi.yaml',
    machines: [
      {
        object: 'Widget',
        states: [{ id: 'active', slaClock: 'running' }],
        initialState: 'active',
      },
    ],
  };

  await t.test('accepts minimal valid document', () => {
    const { valid, errors } = validate(base);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('requires version', () => {
    const { version: _, ...doc } = base;
    const { valid } = validate(doc);
    assert.equal(valid, false);
  });

  await t.test('requires domain', () => {
    const { domain: _, ...doc } = base;
    const { valid } = validate(doc);
    assert.equal(valid, false);
  });

  await t.test('requires apiSpec', () => {
    const { apiSpec: _, ...doc } = base;
    const { valid } = validate(doc);
    assert.equal(valid, false);
  });

  await t.test('requires machines array', () => {
    const { machines: _, ...doc } = base;
    const { valid } = validate(doc);
    assert.equal(valid, false);
  });

  await t.test('machines must have at least one entry', () => {
    const doc = { ...base, machines: [] };
    const { valid } = validate(doc);
    assert.equal(valid, false);
  });

  await t.test('state slaClock must be running | stopped | paused', () => {
    const doc = {
      ...base,
      machines: [{ ...base.machines[0], states: [{ id: 'active', slaClock: 'unknown' }] }],
    };
    const { valid } = validate(doc);
    assert.equal(valid, false);
  });

  await t.test('machine with no triggers or operations is valid', () => {
    const { valid, errors } = validate(base);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

});

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

test('state-machine-schema trigger types', async (t) => {

  function withTriggers(triggers) {
    return {
      version: '1.0', domain: 'test', apiSpec: 'test-openapi.yaml',
      machines: [{
        object: 'Widget',
        states: [{ id: 'draft', slaClock: 'stopped' }, { id: 'active', slaClock: 'running' }],
        initialState: 'draft',
        triggers,
      }],
    };
  }

  await t.test('onCreate trigger', () => {
    const doc = withTriggers({
      onCreate: {
        then: [{ evaluate: 'assignment-rule', description: 'Route on create' }],
      },
    });
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('onUpdate trigger with fields watch list', () => {
    const doc = withTriggers({
      onUpdate: {
        fields: ['isExpedited', 'programType'],
        then: [{ evaluate: 'priority-rule', description: 'Re-evaluate priority' }],
      },
    });
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('onUpdate trigger without fields (fires on any update)', () => {
    const doc = withTriggers({
      onUpdate: {
        then: [{ evaluate: 'priority-rule', description: 'Re-evaluate priority' }],
      },
    });
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('onEvent trigger with name:', () => {
    const doc = withTriggers({
      onEvent: [{
        name: 'external.domain.thing_happened',
        then: [{ emit: { event: 'reacted' }, description: 'React' }],
      }],
    });
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('onEvent trigger with transition', () => {
    const doc = withTriggers({
      onEvent: [{
        name: 'external.domain.thing_happened',
        transition: { from: 'draft', to: 'active' },
        then: [{ emit: { event: 'activated' }, description: 'Activate' }],
      }],
    });
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('onTimer trigger', () => {
    const doc = withTriggers({
      onTimer: [{
        after: '72h',
        relativeTo: 'createdAt',
        calendarType: 'business',
        transition: { from: 'draft', to: 'active' },
        then: [{ emit: { event: 'auto_activated' }, description: 'Auto-activate' }],
      }],
    });
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('onTimer with negative duration (fires before reference point)', () => {
    const doc = withTriggers({
      onTimer: [{
        after: '-48h',
        relativeTo: 'slaDeadline',
        then: [{ emit: { event: 'warning' }, description: 'SLA warning' }],
      }],
    });
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

});

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

test('state-machine-schema operation types', async (t) => {

  function withOperations(operations) {
    return {
      version: '1.0', domain: 'test', apiSpec: 'test-openapi.yaml',
      machines: [{
        object: 'Widget',
        states: [{ id: 'draft', slaClock: 'stopped' }, { id: 'active', slaClock: 'running' }],
        initialState: 'draft',
        operations,
      }],
    };
  }

  await t.test('operation with full transition and guards', () => {
    const doc = withOperations([{
      name: 'activate',
      guards: {
        actors: ['caseworker'],
        conditions: ['callerIsCaseworker'],
      },
      transition: { from: 'draft', to: 'active' },
      then: [
        { set: { field: 'activatedAt', value: '$now' }, description: 'Record activation time' },
        { emit: { event: 'activated' }, description: 'Emit event' },
      ],
    }]);
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('operation without transition (in-place)', () => {
    const doc = withOperations([{
      name: 'flag',
      then: [{ set: { field: 'flagged', value: true }, description: 'Flag it' }],
    }]);
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('operation with multi-state from', () => {
    const doc = withOperations([{
      name: 'withdraw',
      transition: { from: ['draft', 'active'], to: 'draft' },
      then: [{ emit: { event: 'withdrawn' }, description: 'Emit event' }],
    }]);
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('operation with transition from only (no state change)', () => {
    const doc = withOperations([{
      name: 'complete-review',
      transition: { from: 'active' },
      guards: { actors: ['caseworker'], conditions: ['callerIsCaseworker'] },
      then: [{ emit: { event: 'review_completed' }, description: 'Signal review done' }],
    }]);
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('operation with requestBody', () => {
    const doc = withOperations([{
      name: 'withdraw',
      transition: { from: 'active', to: 'draft' },
      requestBody: {
        type: 'object',
        required: ['reason'],
        properties: { reason: { type: 'string' } },
      },
      then: [{ emit: { event: 'withdrawn', data: { reason: '$request.reason' } }, description: 'Emit' }],
    }]);
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('operation with evaluate step', () => {
    const doc = withOperations([{
      name: 'release',
      transition: { from: 'active', to: 'draft' },
      then: [
        { set: { field: 'assignedToId', value: null }, description: 'Clear assignment' },
        { evaluate: 'assignment-rule', description: 'Re-evaluate routing' },
      ],
    }]);
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('operation with invoke step (create)', () => {
    const doc = withOperations([{
      name: 'complete',
      transition: { from: 'active', to: 'draft' },
      then: [{
        invoke: 'workflow/tasks',
        body: { taskType: 'follow_up', status: 'pending' },
        when: { '==': [{ var: '$request.createFollowUp' }, true] },
        description: 'Create follow-up task',
      }],
    }]);
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('operation with invoke step (append)', () => {
    const doc = withOperations([{
      name: 'add-note',
      transition: { from: 'active' },
      then: [{
        invoke: 'widgets/$object.id',
        append: { field: 'notes', value: '$request.note' },
        description: 'Append note',
      }],
    }]);
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

});

// ---------------------------------------------------------------------------
// Guards composition
// ---------------------------------------------------------------------------

test('state-machine-schema guards composition', async (t) => {

  function docWithGuards(conditions) {
    return {
      version: '1.0', domain: 'test', apiSpec: 'test-openapi.yaml',
      machines: [{
        object: 'Widget',
        states: [{ id: 'draft', slaClock: 'stopped' }],
        initialState: 'draft',
        operations: [{
          name: 'do-thing',
          guards: { actors: ['caseworker'], conditions },
          then: [{ emit: { event: 'done' }, description: 'Done' }],
        }],
      }],
    };
  }

  await t.test('string condition (single guard id)', () => {
    const { valid, errors } = validate(docWithGuards(['callerIsCaseworker']));
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('any: composition', () => {
    const { valid, errors } = validate(docWithGuards([{ any: ['callerIsCaseworker', 'callerIsSupervisor'] }]));
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('all: composition', () => {
    const { valid, errors } = validate(docWithGuards([{ all: ['callerIsCaseworker', 'taskIsUnassigned'] }]));
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('mixed string and any: in same conditions list', () => {
    const { valid, errors } = validate(docWithGuards(['taskIsUnassigned', { any: ['callerIsCaseworker', 'callerIsSupervisor'] }]));
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

});

// ---------------------------------------------------------------------------
// Domain-level guards and rules
// ---------------------------------------------------------------------------

test('state-machine-schema domain-level guards and rules', async (t) => {

  const base = {
    version: '1.0', domain: 'test', apiSpec: 'test-openapi.yaml',
    machines: [{
      object: 'Widget',
      states: [{ id: 'active', slaClock: 'running' }],
      initialState: 'active',
    }],
  };

  await t.test('guards array with is_null operator', () => {
    const doc = {
      ...base,
      guards: [{ id: 'widgetIsUnassigned', field: 'assignedToId', operator: 'is_null' }],
    };
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('guards array with contains_any and value', () => {
    const doc = {
      ...base,
      guards: [{ id: 'callerIsSupervisor', field: '$caller.roles', operator: 'contains_any', value: ['supervisor'] }],
    };
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('rules array with first-match-wins evaluation', () => {
    const doc = {
      ...base,
      rules: [{
        id: 'routing-rule',
        evaluation: 'first-match-wins',
        conditions: [{
          id: 'snap-queue',
          order: 1,
          condition: true,
          then: [{ set: { field: 'queueId', value: 'snap-intake' } }],
          description: 'Route to SNAP queue',
        }],
      }],
    };
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('rules array with all-match evaluation', () => {
    const doc = {
      ...base,
      rules: [{
        id: 'create-documents-rule',
        evaluation: 'all-match',
        conditions: [
          {
            id: 'snap-income-doc',
            order: 1,
            condition: { in: ['snap', { var: '$application.programs' }] },
            then: [{ invoke: 'intake/applications/documents', body: { category: 'income' } }],
            description: 'Request income doc for SNAP',
          },
          {
            id: 'snap-identity-doc',
            order: 2,
            condition: { in: ['snap', { var: '$application.programs' }] },
            then: [{ invoke: 'intake/applications/documents', body: { category: 'identity' } }],
            description: 'Request identity doc for SNAP',
          },
        ],
      }],
    };
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('rule with context bindings including optional', () => {
    const doc = {
      ...base,
      rules: [{
        id: 'open-application-rule',
        conditions: [{
          id: 'open-application',
          order: 1,
          condition: true,
          then: [{ invoke: 'intake/applications/$application.id/open' }],
          description: 'Open the application',
        }],
        context: [
          { task: { from: 'workflow/tasks', where: { id: '$this.subject' } } },
          { application: { from: 'intake/applications', where: { id: '$task.subjectId' }, optional: true } },
        ],
      }],
    };
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('multiple machines in one file', () => {
    const doc = {
      ...base,
      machines: [
        ...base.machines,
        {
          object: 'WidgetDocument',
          states: [{ id: 'requested', slaClock: 'stopped' }, { id: 'verified', slaClock: 'stopped' }],
          initialState: 'requested',
          operations: [{
            name: 'verify',
            guards: { actors: ['system'], conditions: ['callerIsSystem'] },
            transition: { from: 'requested', to: 'verified' },
            then: [{ emit: { event: 'verified' }, description: 'Mark verified' }],
          }],
        },
      ],
    };
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('machine with both triggers and operations', () => {
    const doc = {
      ...base,
      machines: [{
        object: 'Widget',
        states: [{ id: 'draft', slaClock: 'stopped' }, { id: 'active', slaClock: 'running' }],
        initialState: 'draft',
        triggers: {
          onCreate: {
            then: [{ evaluate: 'routing-rule', description: 'Route on create' }],
          },
        },
        operations: [{
          name: 'activate',
          guards: { actors: ['caseworker'], conditions: ['callerIsCaseworker'] },
          transition: { from: 'draft', to: 'active' },
          then: [{ emit: { event: 'activated' }, description: 'Activate' }],
        }],
      }],
    };
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

});
