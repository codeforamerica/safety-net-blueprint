/**
 * The Amazon Transcribe client adapter, with no AWS account: a fake
 * WebSocket plays Transcribe's side, framing its messages with AWS's own
 * event stream codec (a devDependency), and the package's codec is checked
 * against that codec in both directions.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { EventStreamCodec } from '@smithy/eventstream-codec';
import { toUtf8, fromUtf8 } from '@smithy/util-utf8';
import { createMockServer } from '@codeforamerica/blueprint-mock-server/browser';
import { encodeMessage, decodeMessage, decodeMessages } from '../src/client/adapters/aws/eventstream.js';
import { createAwsTranscribeAdapter, createTranscriptionClient } from '../src/client/index.js';
import { createTranscriptsAdapter, awsTranscribeIssuer } from '../src/server/index.js';
import { sdkFor } from './sdk.js';

const aws = new EventStreamCodec(toUtf8, fromUtf8);
const RESULTS = JSON.parse(readFileSync(new URL('./fixtures/transcribe-results.json', import.meta.url), 'utf8')).events;
const strings = (headers) => Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, { type: 'string', value: v }]));
const transcriptEvent = (payload) => aws.encode({
  headers: strings({ ':content-type': 'application/json', ':event-type': 'TranscriptEvent', ':message-type': 'event' }),
  body: fromUtf8(JSON.stringify(payload)),
});

test('a message the package encodes is what AWS\'s codec reads', () => {
  const payload = new Uint8Array([1, 2, 3, 250, 0, 7]);
  const headers = { ':content-type': 'application/octet-stream', ':event-type': 'AudioEvent', ':message-type': 'event' };
  const read = aws.decode(encodeMessage(headers, payload));
  assert.deepStrictEqual(Object.fromEntries(Object.entries(read.headers).map(([k, v]) => [k, v.value])), headers);
  assert.deepStrictEqual([...read.body], [...payload]);
});

test('a message AWS\'s codec encodes is what the package reads', () => {
  const { headers, payload } = decodeMessage(transcriptEvent(RESULTS[1]));
  assert.strictEqual(headers[':event-type'], 'TranscriptEvent');
  assert.deepStrictEqual(JSON.parse(new TextDecoder().decode(payload)), RESULTS[1]);
});

test('a frame carrying several messages is read as all of them', () => {
  const first = transcriptEvent(RESULTS[0]);
  const second = transcriptEvent(RESULTS[1]);
  const frame = new Uint8Array(first.length + second.length);
  frame.set(first);
  frame.set(second, first.length);
  const read = decodeMessages(frame).map((m) => JSON.parse(new TextDecoder().decode(m.payload)));
  assert.deepStrictEqual(read, [RESULTS[0], RESULTS[1]]);
});

test('a message with a wrong checksum is refused', () => {
  const message = transcriptEvent(RESULTS[0]);
  message[message.length - 1] ^= 0xff;
  assert.throws(() => decodeMessage(message), /checksum/);
});

/**
 * Transcribe's side of the connection: opens, records what it's sent, sends
 * the results it's given, and on the end of the audio closes, as Transcribe
 * does once its last results are out.
 */
class FakeTranscribe extends EventTarget {
  static last;
  static refuse = false;
  constructor(url) {
    super();
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeTranscribe.last = this;
    setTimeout(() => {
      if (FakeTranscribe.refuse) {
        this.dispatchEvent(new Event('error'));
        this.close();
        return;
      }
      this.readyState = 1;
      this.dispatchEvent(new Event('open'));
    });
  }
  send(data) {
    this.sent.push(aws.decode(data));
    if (this.sent.at(-1).body.length === 0) setTimeout(() => this.close());
  }
  results(...payloads) {
    const frames = payloads.map(transcriptEvent);
    const data = new Uint8Array(frames.reduce((n, f) => n + f.length, 0));
    let offset = 0;
    for (const f of frames) { data.set(f, offset); offset += f.length; }
    this.dispatchEvent(new MessageEvent('message', { data: data.buffer }));
  }
  exception(type, message) {
    const data = aws.encode({
      headers: strings({ ':exception-type': type, ':message-type': 'exception', ':content-type': 'application/json' }),
      body: fromUtf8(JSON.stringify({ Message: message })),
    });
    this.dispatchEvent(new MessageEvent('message', { data: data.buffer }));
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }
}

const recorder = () => {
  const told = { update: [], add: [], dropped: 0 };
  return { told, report: { update: (l) => told.update.push(l), add: (l) => told.add.push(l), dropped: () => { told.dropped += 1; } } };
};
const CONNECTION = { provider: 'aws-transcribe', protocol: 'websocket', url: 'wss://transcribe.example/stream', expiresIn: 300 };
async function* chunks(...parts) { for (const part of parts) yield new Uint8Array(part); }

beforeEach(() => { FakeTranscribe.refuse = false; });

test('results become lines in progress and finished lines, keyed by ResultId', async () => {
  const { told, report } = recorder();
  const handle = await createAwsTranscribeAdapter({ WebSocket: FakeTranscribe }).open({ connection: CONNECTION, audio: chunks(), report });
  for (const results of RESULTS) FakeTranscribe.last.results(results);
  await handle.finish();

  assert.deepStrictEqual(told.update, [{ key: 'r1', text: 'Who lives', start: 0.5, speakerLabel: 'spk_0' }]);
  assert.strictEqual(told.add.length, 2);
  const [first, second] = told.add;
  assert.deepStrictEqual({ ...first, confidence: Number(first.confidence.toFixed(3)) },
    { key: 'r1', text: 'Who lives with you?', start: 0.5, end: 1.8, speakerLabel: 'spk_0', confidence: 0.97, language: 'en-US' });
  assert.strictEqual(second.speakerLabel, 'spk_1');
  assert.strictEqual(told.dropped, 0);
});

test('audio goes out as AudioEvent messages, and finishing sends an empty one', async () => {
  const { report } = recorder();
  const handle = await createAwsTranscribeAdapter({ WebSocket: FakeTranscribe }).open({ connection: CONNECTION, audio: chunks([1, 2], [3, 4, 5]), report });
  await new Promise((resolve) => setTimeout(resolve, 10));
  await handle.finish();
  const sent = FakeTranscribe.last.sent;
  assert.deepStrictEqual(sent.map((m) => [...m.body]), [[1, 2], [3, 4, 5], []]);
  assert.strictEqual(sent[0].headers[':event-type'].value, 'AudioEvent');
  assert.strictEqual(FakeTranscribe.last.url, CONNECTION.url);
});

test('results that arrive together in one frame are all reported', async () => {
  const { told, report } = recorder();
  const handle = await createAwsTranscribeAdapter({ WebSocket: FakeTranscribe }).open({ connection: CONNECTION, audio: chunks(), report });
  FakeTranscribe.last.results(RESULTS[1], RESULTS[3]);
  await handle.finish();
  assert.deepStrictEqual(told.add.map((l) => l.text), ['Who lives with you?', 'My two kids.']);
});

test('an exception from Transcribe closes the connection, which is a drop', async () => {
  const { told, report } = recorder();
  const { error } = console;
  console.error = () => {};
  try {
    await createAwsTranscribeAdapter({ WebSocket: FakeTranscribe }).open({ connection: CONNECTION, audio: chunks(), report });
    FakeTranscribe.last.exception('BadRequestException', 'Your request timed out because no new audio was received for 15 seconds.');
  } finally { console.error = error; }
  assert.strictEqual(told.dropped, 1);
});

test('a close nobody asked for is reported as a drop', async () => {
  const { told, report } = recorder();
  await createAwsTranscribeAdapter({ WebSocket: FakeTranscribe }).open({ connection: CONNECTION, audio: chunks(), report });
  FakeTranscribe.last.close();
  assert.strictEqual(told.dropped, 1);
});

test('a connection that won\'t open is refused', async () => {
  FakeTranscribe.refuse = true;
  const { report } = recorder();
  await assert.rejects(createAwsTranscribeAdapter({ WebSocket: FakeTranscribe }).open({ connection: CONNECTION, audio: chunks(), report }), /didn't open/);
});

test('end to end: the server adapter issues a presigned URL, and the page streams to it', async () => {
  const contracts = JSON.parse(readFileSync(new URL('../../blueprint-harness/generated/mock/contracts.json', import.meta.url), 'utf8'));
  const issue = createTranscriptsAdapter({
    issuers: { 'aws-transcribe': awsTranscribeIssuer({ region: 'us-east-1', credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' } }) },
  });
  const { log, warn } = console;
  console.log = () => {}; console.warn = () => {};
  let mock;
  try {
    // The routing handler stands in for the network between the mock and the state's adapter.
    mock = await createMockServer({ contracts, routing: [{ operation: 'issueTranscriptConnection', handler: issue }] });
  } finally { console.log = log; console.warn = warn; }

  const send = async (method, path, body) => (await mock.fetch(new Request(`http://localhost${path}`, {
    method, headers: { 'content-type': 'application/json', 'x-caller-id': 'worker-1' }, body: JSON.stringify(body),
  }))).json();
  const profile = await send('POST', '/communication/profiles', { name: 'english', provider: 'aws-transcribe', languages: ['en-US'] });
  const client = createTranscriptionClient({
    ...sdkFor((request) => mock.fetch(request)),
    audio: { encoding: 'linear16', sampleRateHertz: 16000, channelCount: 1 },
    adapters: { 'aws-transcribe': createAwsTranscribeAdapter({ WebSocket: FakeTranscribe }) },
    speakerFor: (label) => (label === 'spk_0' ? 'staff' : 'client'),
    onError: (error) => { throw error; },
  });
  const session = await client.start({ profileId: profile.id, model: 'standard', client: 'interview-assistant/0.1.0', startedAt: '2026-10-12T10:00:00Z' });
  await session.connect(chunks([0, 0]));

  const url = new URL(FakeTranscribe.last.url);
  assert.strictEqual(url.host, 'transcribestreaming.us-east-1.amazonaws.com:8443');
  assert.strictEqual(url.searchParams.get('language-code'), 'en-US');
  assert.ok(url.searchParams.get('X-Amz-Signature'));

  for (const results of RESULTS) FakeTranscribe.last.results(results);
  await session.stop();
  const entries = (await (await mock.fetch(new Request(`http://localhost/communication/transcripts/${session.record.transcriptId}/entries`))).json()).items;
  assert.deepStrictEqual(entries.map((e) => [e.text, e.speaker]), [['Who lives with you?', 'staff'], ['My two kids.', 'client']]);
  assert.strictEqual(session.status, 'closed');
});
