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

  await t.test('domain is optional (platform files omit it)', () => {
    const { domain: _, ...doc } = base;
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('apiSpec is optional (platform files omit it)', () => {
    const { apiSpec: _, ...doc } = base;
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('machines is optional (platform files omit it)', () => {
    const { machines: _, ...doc } = base;
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
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

  await t.test('machine with no events or transitions is valid', () => {
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

  function withEvents(events) {
    return {
      version: '1.0', domain: 'test', apiSpec: 'test-openapi.yaml',
      machines: [{
        object: 'Widget',
        states: [{ id: 'draft', slaClock: 'stopped' }, { id: 'active', slaClock: 'running' }],
        initialState: 'draft',
        events,
      }],
    };
  }

  await t.test('events list (replaces triggers.onEvent)', () => {
    const doc = withEvents([{
      name: 'domain.widget.created',
      steps: [{ call: 'assignToQueue', description: 'Route on create' }],
    }]);
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('events list with name:', () => {
    const doc = withEvents([{
      name: 'external.domain.thing_happened',
      steps: [{ emit: { event: 'reacted', description: 'React' } }],
    }]);
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('events list with transition', () => {
    const doc = withEvents([{
      name: 'external.domain.thing_happened',
      transition: { from: 'draft', to: 'active' },
      steps: [{ emit: { event: 'activated', description: 'Activate' } }],
    }]);
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

});

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

test('state-machine-schema transition types', async (t) => {

  function withTransitions(transitions) {
    return {
      version: '1.0', domain: 'test', apiSpec: 'test-openapi.yaml',
      machines: [{
        object: 'Widget',
        states: [{ id: 'draft', slaClock: 'stopped' }, { id: 'active', slaClock: 'running' }],
        initialState: 'draft',
        transitions,
      }],
    };
  }

  await t.test('operation with full transition and guards', () => {
    const doc = withTransitions([{
      id: 'activate',
      guards: [{ actors: ['caseworker'], conditions: ['callerIsCaseworker'] }],
      transition: { from: 'draft', to: 'active' },
      steps: [
        { set: { field: 'activatedAt', value: '$now', description: 'Record activation time' } },
        { emit: { event: 'activated', description: 'Emit event' } },
      ],
    }]);
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('operation without transition (in-place)', () => {
    const doc = withTransitions([{
      id: 'flag',
      steps: [{ set: { field: 'flagged', value: true, description: 'Flag it' } }],
    }]);
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('operation with multi-state from', () => {
    const doc = withTransitions([{
      id: 'withdraw',
      transition: { from: ['draft', 'active'], to: 'draft' },
      steps: [{ emit: { event: 'withdrawn', description: 'Emit event' } }],
    }]);
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('operation with transition from only (no state change)', () => {
    const doc = withTransitions([{
      id: 'complete-review',
      transition: { from: 'active' },
      guards: [{ actors: ['caseworker'], conditions: ['callerIsCaseworker'] }],
      steps: [{ emit: { event: 'review_completed', description: 'Signal review done' } }],
    }]);
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('operation with requestBody', () => {
    const doc = withTransitions([{
      id: 'withdraw',
      transition: { from: 'active', to: 'draft' },
      requestBody: {
        type: 'object',
        required: ['reason'],
        properties: { reason: { type: 'string' } },
      },
      steps: [{ emit: { event: 'withdrawn', data: { reason: '$request.reason' }, description: 'Emit' } }],
    }]);
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('operation with evaluate step', () => {
    const doc = withTransitions([{
      id: 'release',
      transition: { from: 'active', to: 'draft' },
      steps: [
        { set: { field: 'assignedToId', value: null, description: 'Clear assignment' } },
        { call: 'assignToQueue', description: 'Re-evaluate routing' },
      ],
    }]);
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('operation with call step (object form, create)', () => {
    const doc = withTransitions([{
      id: 'complete',
      transition: { from: 'active', to: 'draft' },
      steps: [{
        if: '$request.createFollowUp == true',
        then: [{
          call: { POST: 'workflow/tasks', body: { taskType: 'follow_up', status: 'pending' } },
        }],
        description: 'Create follow-up task',
      }],
    }]);
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('operation with call step (object form, PATCH append)', () => {
    const doc = withTransitions([{
      id: 'add-note',
      transition: { from: 'active' },
      steps: [{
        call: { PATCH: 'widgets/{object.id}', body: { notes: { $push: '$request.note' } } },
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
        transitions: [{
          id: 'do-thing',
          guards: [{ actors: ['caseworker'], conditions }],
          steps: [{ emit: { event: 'done', description: 'Done' } }],
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

  await t.test('guards array with CEL condition (null check)', () => {
    const doc = {
      ...base,
      guards: [{ id: 'widgetIsUnassigned', condition: 'object.assignedToId == null' }],
    };
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('guards array with CEL condition (role check)', () => {
    const doc = {
      ...base,
      guards: [{ id: 'callerIsSupervisor', condition: '"supervisor" in caller.roles' }],
    };
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('procedure with if step (conditional)', () => {
    const doc = {
      ...base,
      procedures: [{
        id: 'openApplication',
        context: [{ application: { from: 'intake/applications', where: { id: '$task.subjectId' } } }],
        steps: [{
          if: '$task.taskType == "application_review" && $application.status == "submitted"',
          then: [{ call: { POST: 'intake/applications/$application.id/open' } }],
        }],
        description: 'Open the application',
      }],
    };
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('procedure with no condition (then only, call object form)', () => {
    const doc = {
      ...base,
      procedures: [{
        id: 'alwaysRunRule',
        steps: [{ call: { POST: 'intake/applications/$application.id/satisfy' } }],
        description: 'Always runs',
      }],
    };
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('procedure with if/then/else step', () => {
    const doc = {
      ...base,
      procedures: [{
        id: 'routingRule',
        description: 'Route to appropriate queue',
        steps: [{
          if: '$application.programs.size() == 1 && "snap" in $application.programs',
          then: [{ set: { field: 'queueId', value: '$snapQueue.id' } }],
          else: [{ set: { field: 'queueId', value: '$generalQueue.id' } }],
        }],
      }],
    };
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('procedure with match/when step', () => {
    const doc = {
      ...base,
      procedures: [{
        id: 'routeByCategory',
        description: 'Route by verification category',
        steps: [{
          match: '$object.category',
          when: {
            identity: [{ call: { POST: 'data-exchange/service-calls' } }],
            income: [
              { call: { POST: 'data-exchange/service-calls' } },
              { call: { POST: 'data-exchange/service-calls' } },
            ],
          },
        }],
      }],
    };
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('procedure with if wrapping match step', () => {
    const doc = {
      ...base,
      procedures: [{
        id: 'updateOnResult',
        description: 'Handle result when verification is found',
        steps: [{
          if: '$verification.id != null',
          then: [{
            match: '$this.data.result',
            when: {
              conclusive: [{ call: { POST: 'intake/applications/verifications/$verification.id/satisfy' } }],
              inconclusive: [{ call: { POST: 'intake/applications/verifications/$verification.id/mark-inconclusive' } }],
            },
          }],
        }],
      }],
    };
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('procedure with context bindings', () => {
    const doc = {
      ...base,
      procedures: [{
        id: 'openApplicationRule',
        description: 'Open the application',
        context: [
          { task: { from: 'workflow/tasks', where: { id: '$this.subject' } } },
          { application: { from: 'intake/applications', where: { id: '$task.subjectId' } } },
        ],
        steps: [{
          if: '$task.taskType == "application_review"',
          then: [{ call: { POST: 'intake/applications/$application.id/open' } }],
        }],
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
          transitions: [{
            id: 'verify',
            guards: [{ actors: ['system'], conditions: ['callerIsSystem'] }],
            transition: { from: 'requested', to: 'verified' },
            steps: [{ emit: { event: 'verified', description: 'Mark verified' } }],
          }],
        },
      ],
    };
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

  await t.test('machine with both events and transitions', () => {
    const doc = {
      ...base,
      machines: [{
        object: 'Widget',
        states: [{ id: 'draft', slaClock: 'stopped' }, { id: 'active', slaClock: 'running' }],
        initialState: 'draft',
        events: [{
          name: 'domain.widget.created',
          steps: [{ call: 'routing-rule', description: 'Route on create' }],
        }],
        transitions: [{
          id: 'activate',
          guards: [{ actors: ['caseworker'], conditions: ['callerIsCaseworker'] }],
          transition: { from: 'draft', to: 'active' },
          steps: [{ emit: { event: 'activated', description: 'Activate' } }],
        }],
      }],
    };
    const { valid, errors } = validate(doc);
    assert.ok(valid, errorPaths(errors).join('\n'));
  });

});
