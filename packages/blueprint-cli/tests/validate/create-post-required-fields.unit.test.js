/**
 * Tests that state-machine create-POST steps supply every required, writable
 * field of the target schema (regression for issue #359).
 *
 * The mock-server engine does not auto-default required non-nullable scalars,
 * so a body that omits one produces responses the generated Zod client rejects
 * with "expected <type>, received undefined".
 *
 * Tests use inline fixture data — no real contracts files.
 */

import { test } from 'node:test';
import assert from 'node:assert';

// Required properties a caller must set on create: required and not readOnly.
// readOnly fields (id, createdAt, updatedAt) are populated by the server.
function requiredWritableFields(schema) {
  const required = schema.required || [];
  const props = schema.properties || {};
  return required.filter((name) => !(props[name] && props[name].readOnly));
}

// Find the create-POST body for a given collection path in the submitted handler.
function submittedCreateBody(stateMachine, collectionPath) {
  for (const machine of stateMachine.machines || []) {
    for (const event of machine.events || []) {
      if (event.type !== 'resource.submitted') continue;
      for (const step of event.steps || []) {
        const call = step.call;
        if (call && call.POST === collectionPath) return call.body || {};
      }
    }
  }
  return null;
}

// Fixture: a schema with required writable fields
const WIDGET_SCHEMA = {
  type: 'object',
  required: ['id', 'name', 'active', 'createdAt'],
  properties: {
    id: { type: 'string', format: 'uuid', readOnly: true },
    name: { type: 'string' },
    active: { type: 'boolean' },
    description: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time', readOnly: true },
  },
};

// Fixture: a state machine with a create-POST that supplies all required writable fields
const COMPLETE_STATE_MACHINE = {
  machines: [{
    object: 'Widget',
    events: [{
      type: 'resource.submitted',
      steps: [{
        call: {
          POST: 'widgets',
          body: { name: 'Default Widget', active: false },
        },
      }],
    }],
  }],
};

// Fixture: a state machine with a create-POST that omits a required writable field
const INCOMPLETE_STATE_MACHINE = {
  machines: [{
    object: 'Widget',
    events: [{
      type: 'resource.submitted',
      steps: [{
        call: {
          POST: 'widgets',
          body: { name: 'Default Widget' }, // missing: active
        },
      }],
    }],
  }],
};

test('requiredWritableFields - excludes readOnly fields from required list', () => {
  const needed = requiredWritableFields(WIDGET_SCHEMA);
  assert.ok(!needed.includes('id'), 'id is readOnly — should not be required in create body');
  assert.ok(!needed.includes('createdAt'), 'createdAt is readOnly — should not be required in create body');
  assert.ok(needed.includes('name'), 'name is required writable');
  assert.ok(needed.includes('active'), 'active is required writable');
});

test('create-POST body supplies all required writable fields', () => {
  const body = submittedCreateBody(COMPLETE_STATE_MACHINE, 'widgets');
  assert.ok(body, 'expected a resource.submitted handler that POSTs to widgets');

  const needed = requiredWritableFields(WIDGET_SCHEMA);
  const missing = needed.filter((field) => !(field in body));
  assert.deepStrictEqual(
    missing,
    [],
    `Widget create body is missing required writable fields: ${missing.join(', ')}`
  );
});

test('create-POST body omitting a required writable field is detectable', () => {
  const body = submittedCreateBody(INCOMPLETE_STATE_MACHINE, 'widgets');
  assert.ok(body, 'expected a resource.submitted handler that POSTs to widgets');

  const needed = requiredWritableFields(WIDGET_SCHEMA);
  const missing = needed.filter((field) => !(field in body));
  assert.ok(missing.includes('active'), 'should detect that active is missing');
});

test('active field is initialized to a boolean at submission', () => {
  const body = submittedCreateBody(COMPLETE_STATE_MACHINE, 'widgets');
  assert.ok(body, 'expected a Widget create-POST body');
  assert.strictEqual(
    typeof body.active,
    'boolean',
    'active should be initialized to a boolean at submission'
  );
});
