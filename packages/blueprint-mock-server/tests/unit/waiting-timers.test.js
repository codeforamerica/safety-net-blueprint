/**
 * A timer stub stands in for the timer service whether it is registered
 * before the timer is asked for or after: registered after, it fires the
 * timer already waiting. Run against the harness's contracts, where submitting
 * an application asks for a review reminder 72 hours out.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createMockServer } from '../../src/server.js';

const contracts = JSON.parse(readFileSync(new URL('../../../blueprint-harness/generated/contracts.json', import.meta.url), 'utf8'));

let mock;
beforeEach(async () => {
  const log = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
  try { mock = await createMockServer({ contracts, seed: true }); } finally { console.log = log; console.warn = warn; }
  await mock.fetch(new Request('http://localhost/mock/stubs/events', { method: 'DELETE' }));
});

const send = async (method, path, body) => {
  const response = await mock.fetch(new Request(`http://localhost${path}`, {
    method, headers: { 'content-type': 'application/json', 'x-caller-id': 'worker-1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};
const submitted = async () => {
  const { body: application } = await send('POST', '/intake/applications', { programsAppliedFor: ['snap'], channel: 'online' });
  await send('POST', `/intake/applications/${application.id}/submit`);
  return application;
};
const eventsOf = async (type, subject) => (await send('GET', `/platform/events?type=${type}&limit=100`)).body.items
  .filter((event) => event.subject === subject);
const stubReminder = (match = { 'data.callback.event': 'intake.application.review_reminder' }) =>
  send('POST', '/mock/stubs/events', { on: 'platform.timer.requested', match });

test('a timer stub registered after the timer was asked for fires it, and is used up', async () => {
  const application = await submitted();
  assert.strictEqual((await eventsOf('intake.application.review_reminder', application.id)).length, 0, 'waiting 72 hours');

  const { status } = await stubReminder();
  assert.strictEqual(status, 201);
  const [reminder] = await eventsOf('intake.application.review_reminder', application.id);
  const [request] = await eventsOf('platform.timer.requested', application.id);
  assert.ok(reminder, 'the waiting timer fired');
  assert.strictEqual(reminder.causationid, request.id, 'caused by the request that asked for it');
  assert.strictEqual(reminder.data.timerId, request.data.timerId);
  assert.strictEqual((await eventsOf('intake.application.review_overdue', application.id)).length, 1, 'the machine answered it');
  assert.strictEqual((await send('GET', '/mock/stubs/events')).body.total, 0);
});

test('one stub fires one waiting timer, the oldest; the next stub fires the next', async () => {
  const first = await submitted();
  const second = await submitted();
  await stubReminder();
  assert.strictEqual((await eventsOf('intake.application.review_reminder', first.id)).length, 1);
  assert.strictEqual((await eventsOf('intake.application.review_reminder', second.id)).length, 0);
  await stubReminder();
  assert.strictEqual((await eventsOf('intake.application.review_reminder', second.id)).length, 1);
});

test('a stub matching one timer by its id fires that one', async () => {
  const first = await submitted();
  const second = await submitted();
  await stubReminder({ 'data.timerId': `intake.review_reminder.${second.id}` });
  assert.strictEqual((await eventsOf('intake.application.review_reminder', first.id)).length, 0);
  assert.strictEqual((await eventsOf('intake.application.review_reminder', second.id)).length, 1);
});

test('a timer that already fired is not waiting: the stub stays for the next request', async () => {
  const application = await submitted();
  await stubReminder();
  await stubReminder();
  assert.strictEqual((await eventsOf('intake.application.review_reminder', application.id)).length, 1);
  assert.strictEqual((await send('GET', '/mock/stubs/events')).body.total, 1);
  const next = await submitted();
  assert.strictEqual((await eventsOf('intake.application.review_reminder', next.id)).length, 1, 'answered as it was asked for');
  assert.strictEqual((await send('GET', '/mock/stubs/events')).body.total, 0);
});

test('a cancelled timer is not waiting', async () => {
  const application = await submitted();
  const [request] = await eventsOf('platform.timer.requested', application.id);
  await send('POST', '/platform/events', {
    specversion: '1.0', id: crypto.randomUUID(), type: 'platform.timer.cancelled', source: '/intake',
    subject: application.id, time: new Date().toISOString(), datacontenttype: 'application/json',
    data: { timerId: request.data.timerId },
  });
  await stubReminder();
  assert.strictEqual((await eventsOf('intake.application.review_reminder', application.id)).length, 0);
  assert.strictEqual((await send('GET', '/mock/stubs/events')).body.total, 1);
});
