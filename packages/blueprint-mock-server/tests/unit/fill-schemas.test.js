/**
 * The schemas a machine's steps fill values into, found from the harness's
 * contracts (step-calls.js, schemasFor), and the engine's steps using them: a
 * null the schema a value goes into doesn't accept is left out
 * (docs/conventions/resources.yaml, null_and_absent).
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { extract } from '@codeforamerica/blueprint-core/browser';
import { createStepCalls } from '../../src/step-calls.js';
import { apiSpecsFromDocs } from '../../src/spec-loader.js';
import { createMemoryStore } from '../../src/stores/memory-store.js';
import { applySteps, operationCallOf } from '../../src/state-machine-engine.js';

const contracts = JSON.parse(readFileSync(new URL('../../../blueprint-harness/generated/mock/contracts.json', import.meta.url), 'utf8'));

let schemas;
before(() => {
  const docs = extract(contracts, 'docs');
  const stateMachines = extract(docs, 'state-machines');
  const log = console.log; console.log = () => {};
  try {
    const calls = createStepCalls({ apiSpecs: apiSpecsFromDocs(docs), stateMachines, store: createMemoryStore(), docs });
    schemas = calls.schemasFor(stateMachines.find((e) => e.resource?.name === 'Transcript').machine);
  } finally { console.log = log; }
});

describe('the schemas a transcript\'s steps fill values into', () => {
  test('a call by method and path: the route\'s request schema', () => {
    // A profile's description and idleTimeout are optional strings.
    assert.deepStrictEqual(schemas.body('POST', 'communication/profiles', { name: 'x', description: null, idleTimeout: null }), { name: 'x' });
  });

  test('a call by operationId: the operation\'s request schema', () => {
    assert.deepStrictEqual(schemas.call('issueTranscriptConnection', undefined, { provider: 'deepgram', languages: null }), { provider: 'deepgram' });
  });

  test('an event\'s data: its schema in the events document, past the envelope\'s', () => {
    assert.deepStrictEqual(schemas.event('communication.transcript.created', { id: 'a', model: null, closedAt: null }), { id: 'a' });
  });

  test('a field set: the machine\'s resource', () => {
    assert.strictEqual(schemas.field('closedAt', null), false);
  });

  test('a path no API declares, or an event no document does, is left as it is', () => {
    assert.deepStrictEqual(schemas.body('POST', 'nowhere/things', { a: null }), { a: null });
    assert.deepStrictEqual(schemas.event('nowhere.thing.done', { a: null }), { a: null });
  });
});

describe('the steps that use them', () => {
  // Leaves out every null, so a test sees that each step asked.
  const noNulls = (value) => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null));
  const context = (extra = {}) => ({
    object: { id: 'r1', a: null },
    schemas: { body: (m, p, b) => noNulls(b), call: (id, t, p) => noNulls(p), event: (t, d) => noNulls(d), field: () => false },
    ...extra,
  });

  test('a call by method and path', () => {
    const { pendingCreates } = applySteps([{ call: { POST: 'test/things', requestBody: { payload: { a: '$object.a', b: 1 } } } }], {}, context(), null);
    assert.deepStrictEqual(pendingCreates[0].data, { b: 1 });
  });

  test('a call by operationId', () => {
    const call = operationCallOf({ operationId: 'doThing', requestBody: { payload: { a: '$object.a', b: 1 } } }, context());
    assert.deepStrictEqual(call.requestBody.payload, { b: 1 });
  });

  test('an emit', () => {
    const { pendingEvents } = applySteps([{ emit: { type: 'test.thing.done', data: { a: '$object.a', b: 1 } } }], {}, context(), null);
    assert.deepStrictEqual(pendingEvents[0].data, { b: 1 });
  });

  test('a set: of a null the field doesn\'t accept sets nothing', () => {
    const resource = { id: 'r1', a: 'kept' };
    applySteps([{ set: { field: 'a', value: null } }], resource, context({ object: resource }), null);
    assert.strictEqual(resource.a, 'kept');
  });

  test('a call that takes its operation from data, as a client wrote it, is left as written', () => {
    const written = { operationId: 'doThing', requestBody: { payload: { a: null } } };
    const call = operationCallOf('$request.call', context({ request: { call: written } }));
    assert.deepStrictEqual(call.requestBody.payload, { a: null });
  });
});
