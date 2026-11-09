/**
 * The session follows its transcript: paused or closed by someone else, the
 * session pauses or closes too, so the software stops sending audio. Resumed
 * by someone else, it stays paused. The session's own pause and stop still
 * work as before, with the reactions finding nothing to do.
 *
 * The contract alone, through the mock's HTTP API, with no driver. The
 * session's reactions find it through its transcriptId, so it publishes no
 * action for them.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createMockServer } from '@codeforamerica/blueprint-mock-server/browser';

const contracts = JSON.parse(readFileSync(new URL('../../blueprint-harness/generated/mock/contracts.json', import.meta.url), 'utf8'));

let mock;
beforeEach(async () => {
  const log = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
  try {
    mock = await createMockServer({
      contracts,
      routing: [{
        operation: 'issueTranscriptConnection',
        handler: async (request) => {
          const { metadata } = await request.json();
          return Response.json({ metadata, provider: 'aws-transcribe', protocol: 'websocket', url: 'wss://transcribe.example/stream', expiresIn: 300 });
        },
      }],
    });
  } finally { console.log = log; console.warn = warn; }
});

const send = async (method, path, body) => {
  const response = await mock.fetch(new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-caller-id': 'worker-1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json().catch(() => null) };
};

const at = (seconds) => new Date(Date.parse('2026-10-12T10:00:00Z') + seconds * 1000).toISOString();

/** A session that's connected, and its transcript. */
async function connected() {
  const profile = (await send('POST', '/communication/profiles', { name: 'english', provider: 'aws-transcribe', languages: ['en-US'] })).body;
  const session = (await send('POST', '/communication/transcription-sessions', {
    profileId: profile.id, model: 'standard', client: 'interview-assistant/0.1.0', startedAt: at(0),
  })).body;
  const path = `/communication/transcription-sessions/${session.id}`;
  assert.strictEqual((await send('POST', `${path}/get-connection`, {
    audio: { encoding: 'linear16', sampleRateHertz: 16000, channelCount: 1 }, protocols: ['websocket'],
  })).status, 200);
  assert.strictEqual((await send('POST', `${path}/connect`, {})).status, 200);
  const { transcriptId } = (await send('GET', path)).body;
  return { path, transcript: `/communication/transcripts/${transcriptId}` };
}

const statusOf = async (path) => (await send('GET', path)).body.status;

/** Reactions may run just after the call that set them off returns. */
const eventually = async (check) => {
  for (let i = 0; i < 100; i += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('timed out');
};

test('the transcript paused by someone else pauses the session', async () => {
  const { path, transcript } = await connected();
  assert.strictEqual((await send('POST', `${transcript}/pause`, { at: at(10) })).status, 200);
  await eventually(async () => (await statusOf(path)) === 'paused');
});

test('the transcript resumed by someone else leaves the session paused', async () => {
  const { path, transcript } = await connected();
  await send('POST', `${transcript}/pause`, { at: at(10) });
  await eventually(async () => (await statusOf(path)) === 'paused');
  assert.strictEqual((await send('POST', `${transcript}/resume`, { at: at(20) })).status, 200);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.strictEqual(await statusOf(path), 'paused');
});

test('the transcript closed by someone else closes the session', async () => {
  const { path, transcript } = await connected();
  assert.strictEqual((await send('POST', `${transcript}/close`, { at: at(10) })).status, 200);
  await eventually(async () => (await statusOf(path)) === 'closed');
});

test('the software can resume the session after following a pause, even once someone else resumed the transcript', async () => {
  const { path, transcript } = await connected();
  await send('POST', `${transcript}/pause`, { at: at(10) });
  await eventually(async () => (await statusOf(path)) === 'paused');
  // Someone else resumed the transcript first; the software's resume still works.
  await send('POST', `${transcript}/resume`, { at: at(20) });
  const resumed = await send('POST', `${path}/resume`, { at: at(30) });
  assert.strictEqual(resumed.status, 200, JSON.stringify(resumed.body));
  assert.strictEqual(await statusOf(path), 'connecting');
});

test('the session\'s own pause and stop work as before', async () => {
  const { path } = await connected();
  assert.strictEqual((await send('POST', `${path}/pause`, { at: at(10) })).status, 200);
  assert.strictEqual(await statusOf(path), 'paused');
  assert.strictEqual((await send('POST', `${path}/resume`, { at: at(20) })).status, 200);
  assert.strictEqual((await send('POST', `${path}/get-connection`, {
    audio: { encoding: 'linear16', sampleRateHertz: 16000, channelCount: 1 }, protocols: ['websocket'],
  })).status, 200);
  assert.strictEqual((await send('POST', `${path}/connect`, {})).status, 200);
  assert.strictEqual((await send('POST', `${path}/stop`, { at: at(30) })).status, 200);
  const closed = await send('POST', `${path}/close`, { at: at(31) });
  assert.strictEqual(closed.status, 200, JSON.stringify(closed.body));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.strictEqual(await statusOf(path), 'closed');
});

test('following the transcript publishes no action of its own', async () => {
  const { path } = await connected();
  for (const action of ['transcript-paused', 'transcript-closed']) {
    assert.strictEqual((await send('POST', `${path}/${action}`, {})).status, 404, action);
  }
});
