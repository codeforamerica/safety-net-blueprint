/**
 * An action calling an operation: made in order, as the caller with
 * `runAs: caller`, and handled with `onFailure:` when it fails.
 *
 * Run against the harness's contracts, with the Suggestion machine given a
 * trial action that calls the operation a suggestion holds — the shape
 * accepting will take.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discover, load, generate } from '@codeforamerica/blueprint-core';
import { createMockServer } from '../../src/browser.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const harness = resolve(packageRoot, '../blueprint-harness/generated/resolved');
const APPLICATION = '11111111-1111-4111-8111-111111111111';

/** The harness, with the Suggestion machine's actions replaced by `actions`. */
function contractsWith(actions) {
  const docs = discover(harness).map(load).map((doc) => {
    if (doc.type !== 'state-machine' || doc.content?.domain !== 'decision-support') return doc;
    const [machine] = doc.content.machines;
    return {
      ...doc,
      content: { ...doc.content, machines: [{ ...machine, emits: [{ id: 'tried' }, { id: 'failed_try' }], actions }] },
    };
  });
  return generate(docs, 'artifact');
}

const tryIt = (onFailure) => ({
  id: 'try',
  transition: { from: 'proposed', to: 'accepted' },
  steps: [
    { set: { field: 'reason', value: 'before the call' } },
    { call: '$object.call', runAs: 'caller', ...(onFailure ? { onFailure } : {}) },
    { emit: 'tried' },
  ],
});
const handled = {
  to: 'refused',
  then: [
    { set: { field: 'reason', value: '$failure.error.message' } },
    { emit: 'failed_try' },
  ],
};

let mock;
async function boot(actions) {
  const log = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
  try { mock = await createMockServer({ contracts: contractsWith(actions), seed: true }); } finally { console.log = log; console.warn = warn; }
}

const send = async (method, path, body, caller = 'worker-1') => {
  const response = await mock.fetch(new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-caller-id': caller, 'x-caller-roles': 'worker' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

let member;
async function propose(body) {
  ({ body: member } = await send('POST', `/intake/applications/${APPLICATION}/members`, { firstName: 'Rosa', lastName: 'Diaz', relationship: 'self' }));
  const { body: suggestion } = await send('POST', '/decision-support/suggestions', {
    kind: 'operation',
    call: {
      operationId: 'updateApplicationMember',
      parameters: [
        { name: 'applicationId', in: 'path', value: APPLICATION },
        { name: 'memberId', in: 'path', value: member.id },
      ],
      body,
    },
  }, 'assistant-1');
  return suggestion;
}
const events = async (type) => (await send('GET', `/platform/events?q=${encodeURIComponent(`type:${type}`)}&limit=100`)).body.items;

beforeEach(() => { mock = null; });

test('the call is made as the caller, and its events name the action\'s as their cause', async () => {
  await boot([tryIt(handled)]);
  const suggestion = await propose({ firstName: 'Rosalind' });

  const { status, body } = await send('POST', `/decision-support/suggestions/${suggestion.id}/try`, {});
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.status, 'accepted');
  assert.equal(body.reason, 'before the call', 'steps before the call are kept when it succeeds');

  const { body: after } = await send('GET', `/intake/applications/${APPLICATION}/members/${member.id}`);
  assert.equal(after.firstName, 'Rosalind');

  const [tried] = await events('decision-support.suggestion.tried');
  const updated = (await events('intake.application_member.updated')).find((e) => e.subject === member.id);
  assert.equal(updated.authid, 'worker-1', 'made as the person who triggered the action');
  assert.equal(updated.causationid, tried.id, 'the update names the action\'s event as its cause');
});

// The record the call changes is gone by the time it is made.
async function proposeThenDelete() {
  const suggestion = await propose({ firstName: 'Rosalind' });
  await send('DELETE', `/intake/applications/${APPLICATION}/members/${member.id}`);
  return suggestion;
}

test('a call that fails runs onFailure instead of the action\'s steps, and the action answers with the failure', async () => {
  await boot([tryIt(handled)]);
  const suggestion = await proposeThenDelete();

  const { status, body } = await send('POST', `/decision-support/suggestions/${suggestion.id}/try`, {});
  assert.equal(status, 404, JSON.stringify(body));
  const [record] = body.details;
  assert.equal(record.id, suggestion.id);
  assert.equal(record.status, 'refused', 'ends where onFailure says');
  assert.notEqual(record.reason, 'before the call', 'the action\'s own steps are discarded');
  assert.equal(record.reason, body.message, 'onFailure reads the failure');

  assert.equal((await events('decision-support.suggestion.tried')).length, 0);
  assert.equal((await events('decision-support.suggestion.failed_try')).length, 1);
});

test('a call that fails with no onFailure fails the action, and nothing is saved', async () => {
  await boot([tryIt(null)]);
  const suggestion = await proposeThenDelete();

  const { status } = await send('POST', `/decision-support/suggestions/${suggestion.id}/try`, {});
  assert.equal(status, 404);
  const { body: after } = await send('GET', `/decision-support/suggestions/${suggestion.id}`);
  assert.equal(after.status, 'proposed');
  assert.equal(after.reason, undefined);
  assert.equal((await events('decision-support.suggestion.tried')).length, 0);
});
