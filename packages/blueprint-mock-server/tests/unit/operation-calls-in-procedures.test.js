/**
 * A procedure, or a machine's reaction to an event, calling an operation: made
 * where it stands, and handled with `onFailure:` when it fails, as in an
 * action (operation-calls-in-actions.test.js).
 *
 * Run against the harness's contracts, the Suggestion machine given trial
 * actions, procedures and reactions that propose more suggestions through the
 * createSuggestion operation — so the API's checks, a repeat's 409 among them,
 * apply to them.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discover, load, generate } from '@codeforamerica/blueprint-core';
import { createMockServer } from '../../src/browser.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const harness = resolve(packageRoot, '../blueprint-harness/generated/resolved');
const MEMBER = '1b7d9e3f-2a4c-4e6b-8d0f-3c5e7a9b1d26';

/** The harness, with the Suggestion machine given more actions, procedures and reactions. */
function contractsWith({ actions = [], procedures = [], on = [], dismissedOnlyBy = null }) {
  const docs = discover(harness).map(load).map((doc) => {
    if (doc.type !== 'state-machine' || doc.content?.domain !== 'decision-support') return doc;
    const [machine] = doc.content.machines;
    return {
      ...doc,
      content: {
        ...doc.content,
        machines: [{
          ...machine,
          emits: [...machine.emits, { id: 'tried' }, { id: 'failed_try' }],
          // As an overlay restricting who may dismiss would leave it.
          actions: [...machine.actions.map((action) => (dismissedOnlyBy && action.id === 'dismiss'
            ? { ...action, guards: [...(action.guards ?? []), { actors: dismissedOnlyBy }] }
            : action)), ...actions],
          procedures: [...(machine.procedures ?? []), ...procedures],
          on: [...(machine.on ?? []), ...on],
        }],
      },
    };
  });
  return generate(docs, 'artifact');
}

let mock;
async function boot(additions) {
  const log = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
  try { mock = await createMockServer({ contracts: contractsWith(additions), seed: true }); } finally { console.log = log; console.warn = warn; }
}

const send = async (method, path, body, roles = 'worker') => {
  const response = await mock.fetch(new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-caller-id': 'worker-1', 'x-caller-roles': roles },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};
const inform = (category) => send('POST', '/decision-support/suggestions', {
  kind: 'informing', subjectType: 'application_member', subjectId: MEMBER, category,
});
const suggestions = async () => (await send('GET', '/decision-support/suggestions?limit=100')).body.items;
const events = async (type) => (await send('GET', `/platform/events?type=${type}`)).body.items;
// A reaction runs after the response that caused it; let its calls finish.
const settle = () => new Promise((done) => setTimeout(done, 20));

// Propose one more suggestion about the same member, through the operation,
// as the worker who ran the action.
const proposeAbout = (category, onFailure) => ({
  call: {
    operationId: 'createSuggestion',
    body: { kind: 'informing', subjectType: '$object.subjectType', subjectId: '$object.subjectId', category },
  },
  runAs: 'caller',
  ...(onFailure ? { onFailure } : {}),
});

test('a procedure calls an operation, and a repeat it handles with onFailure ends only that procedure', async () => {
  await boot({
    actions: [{
      id: 'spread',
      transition: { from: 'proposed', to: 'proposed' },
      steps: [{ forEach: { in: '$request.categories', as: 'category' }, do: [{ call: 'proposeOne', with: { category: '$category' } }] }],
    }],
    procedures: [{
      id: 'proposeOne',
      parameters: ['category'],
      steps: [proposeAbout('$params.category', { then: [] })],
    }],
  });
  const { body: first } = await inform('name-mismatch');
  const { status, body } = await send('POST', `/decision-support/suggestions/${first.id}/spread`, {
    categories: ['name-mismatch', 'missing-income'],
  });
  assert.equal(status, 200, JSON.stringify(body));
  const made = await suggestions();
  assert.deepEqual(made.map((s) => s.category).sort(), ['missing-income', 'name-mismatch']);
  const added = made.find((s) => s.category === 'missing-income');
  assert.equal(added.status, 'proposed');
  assert.match(added.fingerprint, /^[0-9a-f]{64}$/);
});

test('a procedure\'s call failing with no onFailure fails the action, and nothing is saved', async () => {
  await boot({
    actions: [{
      id: 'spread',
      transition: { from: 'proposed', to: 'dismissed' },
      steps: [{ set: { field: 'reason', value: 'spread' } }, { call: 'proposeOne' }],
    }],
    procedures: [{ id: 'proposeOne', steps: [proposeAbout('name-mismatch')] }],
  });
  const { body: first } = await inform('name-mismatch');
  const { status, body } = await send('POST', `/decision-support/suggestions/${first.id}/spread`, {});
  assert.equal(status, 409, JSON.stringify(body));
  assert.equal(body.details[0].id, first.id);
  const { body: after } = await send('GET', `/decision-support/suggestions/${first.id}`);
  assert.equal(after.status, 'proposed');
  assert.equal(after.reason, undefined);
});

test('a reaction to an event calls an operation, its events caused by the event', async () => {
  await boot({
    on: [{ type: 'decision-support.suggestion.dismissed', steps: [proposeAbout('missing-income')] }],
  });
  const { body: first } = await inform('name-mismatch');
  await send('POST', `/decision-support/suggestions/${first.id}/dismiss`, { reason: 'Spelled right.' });
  await settle();
  const added = (await suggestions()).find((s) => s.category === 'missing-income');
  assert.ok(added, 'the reaction proposed a suggestion');
  assert.equal(added.status, 'proposed');
  const [dismissed] = await events('decision-support.suggestion.dismissed');
  const created = (await events('decision-support.suggestion.created')).find((e) => e.subject === added.id);
  assert.equal(created.causationid, dismissed.id);
});

test('a reaction\'s call that fails runs its onFailure, with $failure', async () => {
  await boot({
    on: [{
      type: 'decision-support.suggestion.dismissed',
      steps: [
        proposeAbout('name-mismatch', {
          then: [{ emit: { event: 'failed_try', data: { status: '$failure.status', code: '$failure.error.code' } } }],
        }),
        { emit: 'tried' },
      ],
    }],
  });
  const { body: first } = await inform('name-mismatch');
  await send('POST', `/decision-support/suggestions/${first.id}/dismiss`, { reason: 'Spelled right.' });
  await settle();
  const [failed] = await events('decision-support.suggestion.failed_try');
  assert.ok(failed, 'onFailure ran');
  assert.deepEqual(failed.data, { status: 409, code: 'CONFLICT' });
  assert.equal((await events('decision-support.suggestion.tried')).length, 0);
});

test('a record a step creates directly starts in its initial state, and is announced as an API create would be', async () => {
  await boot({
    actions: [{
      id: 'spread',
      transition: { from: 'proposed', to: 'proposed' },
      steps: [{
        call: {
          POST: 'decision-support/suggestions',
          body: { kind: 'informing', subjectType: 'application_member', subjectId: MEMBER, category: 'missing-income' },
        },
      }, { emit: 'tried' }],
    }],
  });
  const { body: first } = await inform('name-mismatch');
  assert.equal((await send('POST', `/decision-support/suggestions/${first.id}/spread`, {})).status, 200);
  const added = (await suggestions()).find((s) => s.category === 'missing-income');
  assert.equal(added.status, 'proposed');

  const created = (await events('decision-support.suggestion.created')).find((e) => e.subject === added.id);
  assert.ok(created, 'a created event');
  assert.equal(created.source, '/decision-support');
  assert.equal(created.authid, 'worker-1');
  const [tried] = await events('decision-support.suggestion.tried');
  assert.equal(created.causationid, tried.id);
  // The machine's reaction to its own created event ran: the expiry default.
  assert.ok(added.expiresAt, 'expiresAt set by the reaction to created');
});

// runAs: system — the default — goes through the API as the system: every check
// applies except role matching, and its events name the system as who acted.

const retire = (runAs) => ({
  id: 'retire',
  transition: { from: 'proposed', to: 'proposed' },
  steps: [{
    call: {
      operationId: 'dismissSuggestion',
      parameters: [{ name: 'suggestionId', in: 'path', value: '$request.otherId' }],
      body: { reason: 'Covered by another.' },
    },
    ...(runAs ? { runAs } : {}),
  }, { emit: 'tried' }],
});

test('a system call skips a role restriction an overlay adds; the same call as the caller does not', async () => {
  await boot({ dismissedOnlyBy: ['supervisor'], actions: [retire(), { ...retire('caller'), id: 'retireAsMe' }] });
  const { body: one } = await inform('name-mismatch');
  const { body: other } = await inform('missing-income');

  assert.equal((await send('POST', `/decision-support/suggestions/${other.id}/dismiss`, { reason: 'x' })).status, 403);
  const asMe = await send('POST', `/decision-support/suggestions/${one.id}/retireAsMe`, { otherId: other.id });
  assert.equal(asMe.status, 403, JSON.stringify(asMe.body));

  const { status, body } = await send('POST', `/decision-support/suggestions/${one.id}/retire`, { otherId: other.id });
  assert.equal(status, 200, JSON.stringify(body));
  const { body: after } = await send('GET', `/decision-support/suggestions/${other.id}`);
  assert.equal(after.status, 'dismissed');

  const [dismissed] = await events('decision-support.suggestion.dismissed');
  assert.equal(dismissed.authid, 'system');
  assert.equal(dismissed.authtype, 'system');
  const [tried] = await events('decision-support.suggestion.tried');
  assert.equal(dismissed.causationid, tried.id, 'causationid links to the action\'s event');
  assert.equal(tried.authid, 'worker-1');
});

test('a client sending X-Caller-Roles: system is a caller with a role named system, not the system', async () => {
  await boot({ dismissedOnlyBy: ['supervisor'] });
  const { body: one } = await inform('name-mismatch');
  const spoofed = await send('POST', `/decision-support/suggestions/${one.id}/dismiss`, { reason: 'x' }, 'system');
  assert.equal(spoofed.status, 403, JSON.stringify(spoofed.body));
});

test('a system call is still validated: a proposal the schema refuses fails the action', async () => {
  await boot({
    actions: [{
      id: 'spread',
      transition: { from: 'proposed', to: 'dismissed' },
      steps: [{ call: { operationId: 'createSuggestion', body: { kind: 'informing', subjectType: 'application_member' } } }],
    }],
  });
  const { body: one } = await inform('name-mismatch');
  const { status, body } = await send('POST', `/decision-support/suggestions/${one.id}/spread`, {});
  assert.equal(status, 422, JSON.stringify(body));
  assert.equal((await send('GET', `/decision-support/suggestions/${one.id}`)).body.status, 'proposed');
});

test('a system call repeating a suggestion still open gets the 409', async () => {
  await boot({
    actions: [{
      id: 'spread',
      transition: { from: 'proposed', to: 'proposed' },
      steps: [{ call: { operationId: 'createSuggestion', body: { kind: 'informing', subjectType: '$object.subjectType', subjectId: '$object.subjectId', category: 'name-mismatch' } } }],
    }],
  });
  const { body: one } = await inform('name-mismatch');
  const { status, body } = await send('POST', `/decision-support/suggestions/${one.id}/spread`, {});
  assert.equal(status, 409, JSON.stringify(body));
  assert.equal(body.details[0].id, one.id);
});

test('a record a step updates directly is announced as an API update would be', async () => {
  const APPLICATION = '11111111-1111-4111-8111-111111111111';
  await boot({
    actions: [{
      id: 'spread',
      transition: { from: 'proposed', to: 'proposed' },
      steps: [{ call: { PATCH: `intake/applications/${APPLICATION}/members/$request.memberId`, body: { firstName: 'Rosa' } } }],
    }],
  });
  const { body: member } = await send('POST', `/intake/applications/${APPLICATION}/members`, { firstName: 'Rose', lastName: 'Diaz', relationship: 'self' });
  const { body: first } = await inform('name-mismatch');
  assert.equal((await send('POST', `/decision-support/suggestions/${first.id}/spread`, { memberId: member.id })).status, 200);
  const { body: after } = await send('GET', `/intake/applications/${APPLICATION}/members/${member.id}`);
  assert.equal(after.firstName, 'Rosa');
  const updated = (await events('intake.application_member.updated')).find((e) => e.subject === member.id);
  assert.ok(updated, 'an updated event');
  assert.equal(updated.authid, 'worker-1');
});
