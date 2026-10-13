/**
 * A recording transcript nobody writes to closes itself, when its profile sets
 * an idleTimeout — run against the harness's contracts, with the mock's timer
 * stub standing in for the scheduler.
 *
 * A timer stub fires the moment its timer is requested, so the check comes
 * before anything else can arrive. That is the case of a transcript the
 * software abandoned straight away.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createMockServer } from '../../src/browser.js';

const contracts = JSON.parse(readFileSync(new URL('../../../blueprint-harness/generated/mock/contracts.json', import.meta.url), 'utf8'));
const WITH_TIMEOUT = '7a1e0c2d-0000-4000-8000-0000000000b1';

let mock;
beforeEach(async () => {
  const log = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
  try { mock = await createMockServer({ contracts, seed: true }); } finally { console.log = log; console.warn = warn; }
  // Stubs outlive a server: clear the last test's.
  await mock.fetch(new Request('http://localhost/mock/stubs/events', { method: 'DELETE' }));
});

const send = async (method, path, body, headers = {}) => {
  const response = await mock.fetch(new Request(`http://localhost${path}`, {
    method, headers: { 'content-type': 'application/json', 'x-caller-id': 'worker-1', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};
const start = (profileId) => send('POST', '/transcription/transcripts', {
  profileId, model: 'standard', client: 'interview-assistant/0.1.0', startedAt: '2026-10-12T10:00:00Z',
});
const stubIdleCheck = () => send('POST', '/mock/stubs/events', {
  on: 'scheduling.timer.requested', match: { 'data.callback.event': 'transcription.idle_check' },
});

test('a transcript whose profile sets an idleTimeout closes when the check finds it quiet', async () => {
  await stubIdleCheck();
  const { body: transcript } = await start(WITH_TIMEOUT);
  const { body: after } = await send('GET', `/transcription/transcripts/${transcript.id}`);
  assert.strictEqual(after.status, 'closed');
  assert.strictEqual(after.closedAt, '2026-10-12T10:00:00Z', 'nothing was heard, so it closes when it started');
});

test('a profile with no idleTimeout asks for no check, so the transcript stays open', async () => {
  await stubIdleCheck();
  const { body: profile } = await send('POST', '/transcription/profiles', { name: 'no-timeout', provider: 'aws-transcribe' });
  const { body: transcript } = await start(profile.id);
  const { body: after } = await send('GET', `/transcription/transcripts/${transcript.id}`);
  assert.strictEqual(after.status, 'recording');
});

test('each line or gap records when the software was last heard from; a pause does not', async () => {
  const { body: transcript } = await start(WITH_TIMEOUT);
  const add = (body, key) => send('POST', `/transcription/transcripts/${transcript.id}/entries`, body, { 'idempotency-key': key });
  await add({ kind: 'line', startedAt: '2026-10-12T10:00:05Z', endedAt: '2026-10-12T10:00:07Z', text: 'Hello.', speaker: 'staff' }, 'k1');
  await send('POST', `/transcription/transcripts/${transcript.id}/pause`, { at: '2026-10-12T10:00:10Z' });
  const { body: after } = await send('GET', `/transcription/transcripts/${transcript.id}`);
  assert.strictEqual(after.lastActivityAt, '2026-10-12T10:00:07Z');
});

test('a resumed transcript asks again, and closes at when it was last heard from', async () => {
  const { body: transcript } = await start(WITH_TIMEOUT);
  const add = (body, key) => send('POST', `/transcription/transcripts/${transcript.id}/entries`, body, { 'idempotency-key': key });
  await add({ kind: 'line', startedAt: '2026-10-12T10:00:05Z', endedAt: '2026-10-12T10:00:07Z', text: 'Hello.', speaker: 'staff' }, 'k1');
  await send('POST', `/transcription/transcripts/${transcript.id}/pause`, { at: '2026-10-12T10:00:10Z' });
  await stubIdleCheck();
  await send('POST', `/transcription/transcripts/${transcript.id}/resume`, { at: '2026-10-12T10:00:20Z' });
  const { body: after } = await send('GET', `/transcription/transcripts/${transcript.id}`);
  assert.strictEqual(after.status, 'closed');
  assert.strictEqual(after.closedAt, '2026-10-12T10:00:07Z');
});
