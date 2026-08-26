/**
 * Regression tests for issue #359.
 *
 * A state-machine create-POST must supply every required, writable field of
 * the target schema. The mock-server engine does not auto-default required
 * non-nullable scalars, so a body that omits one produces responses the
 * generated Zod client rejects with "expected <type>, received undefined".
 *
 * The concrete miss: the eligibility Determination create-POST omitted the
 * required non-nullable `expeditedFlagged` boolean.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsRoot = join(__dirname, '../../');

const stateMachine = yaml.load(
  readFileSync(join(contractsRoot, 'eligibility-state-machine.yaml'), 'utf8')
);
const openapi = yaml.load(
  readFileSync(join(contractsRoot, 'eligibility-openapi.yaml'), 'utf8')
);

// Required properties a caller must set on create: required and not readOnly.
// readOnly fields (id, createdAt, updatedAt) are populated by the server.
function requiredWritableFields(schema) {
  const required = schema.required || [];
  const props = schema.properties || {};
  return required.filter((name) => !(props[name] && props[name].readOnly));
}

// Find the create-POST body for a given collection path in the submitted handler.
function submittedCreateBody(collectionPath) {
  for (const machine of stateMachine.machines || []) {
    for (const event of machine.events || []) {
      if (event.type !== 'intake.application.submitted') continue;
      for (const step of event.steps || []) {
        const call = step.call;
        if (call && call.POST === collectionPath) return call.body || {};
      }
    }
  }
  return null;
}

test('Determination create-POST supplies every required writable field (issue #359)', () => {
  const body = submittedCreateBody('eligibility/determinations');
  assert.ok(body, 'expected an intake.application.submitted handler that POSTs a Determination');

  const determination = openapi.components.schemas.Determination;
  const needed = requiredWritableFields(determination);

  const missing = needed.filter((field) => !(field in body));
  assert.deepStrictEqual(
    missing,
    [],
    `Determination create body is missing required writable fields: ${missing.join(', ')}`
  );
});

test('expeditedFlagged is initialized to a boolean at submission', () => {
  const body = submittedCreateBody('eligibility/determinations');
  assert.ok(body, 'expected a Determination create-POST body');
  assert.strictEqual(
    typeof body.expeditedFlagged,
    'boolean',
    'expeditedFlagged should be set at submission; the flag-expedited action promotes it to true later'
  );
});
