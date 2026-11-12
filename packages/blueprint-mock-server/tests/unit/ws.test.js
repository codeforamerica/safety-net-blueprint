/**
 * The WebSockets the mock serves for AsyncAPI documents with servers, and the
 * WebSocket stubs that answer on them: every message checked against the
 * contract both ways, a reply the contract expects and no stub gives closing
 * the connection, as an HTTP call the mock can't answer is a 501. Against the
 * harness's relay contract, communication-transcripts-relay-asyncapi.yaml.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createMockServer, runScenario, operationIndex, controlOperations } from '../../src/server.js';
import { extract } from '@codeforamerica/blueprint-core/browser';

const contracts = JSON.parse(readFileSync(fileURLToPath(new URL('../../../blueprint-harness/generated/mock/contracts.json', import.meta.url)), 'utf8'));
const docs = extract(contracts, 'docs');
const CHANNEL = 'communication-transcripts-relay-asyncapi.yaml#/channels/audio';
const URL_ = 'ws://localhost/communication/transcripts-relay';
const START = { type: 'start', audio: { encoding: 'linear16', sampleRateHertz: 16000, channelCount: 1 } };
const RESULT = { type: 'result', id: 'r1', isFinal: true, startOffsetMs: 0, endOffsetMs: 1200, alternatives: [{ transcript: 'Who lives with you?' }] };

async function quietMock() {
  const log = console.log; console.log = () => {};
  try { return await createMockServer({ contracts }); } finally { console.log = log; }
}

const stub = (mock, body) => mock.fetch(new Request('http://localhost/mock/stubs/ws', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

/** A connection, with what it heard and how it closed. */
function connect(mock) {
  const socket = new mock.WebSocket(URL_);
  const heard = [];
  const closed = new Promise((settle) => socket.addEventListener('close', (e) => settle({ code: e.code, reason: e.reason })));
  socket.addEventListener('message', (e) => heard.push(typeof e.data === 'string' ? JSON.parse(e.data) : e.data));
  const opened = new Promise((settle) => socket.addEventListener('open', settle));
  return { socket, heard, closed, opened };
}
const tick = () => new Promise((settle) => setTimeout(settle, 0));

test('a WebSocket stub answers the message it names, once, with what it says', async () => {
  const mock = await quietMock();
  assert.strictEqual((await stub(mock, { channel: CHANNEL, on: 'start', send: [{ type: 'started' }] })).status, 201);
  assert.strictEqual((await stub(mock, { channel: CHANNEL, on: 'audio', send: [RESULT] })).status, 201);
  const { socket, heard, opened } = connect(mock);
  await opened;
  socket.send(JSON.stringify(START));
  socket.send(new Uint8Array([1, 2, 3, 4]));
  socket.send(new Uint8Array([5, 6]));
  await tick();
  assert.deepStrictEqual(heard, [{ type: 'started' }, RESULT], 'each stub answered once; the second audio frame had none and needs no reply');
  const left = await (await mock.fetch(new Request('http://localhost/mock/stubs/ws'))).json();
  assert.strictEqual(left.total, 0);
});

test('a message the contract doesn\'t let the mock receive closes the connection with 1007', async () => {
  const mock = await quietMock();
  const { socket, closed, opened } = connect(mock);
  await opened;
  socket.send(JSON.stringify({ type: 'start' }));
  const { code, reason } = await closed;
  assert.strictEqual(code, 1007);
  assert.match(reason, /not start/);
});

test('a message the contract says is answered, with no stub to answer it, closes the connection with 1011', async () => {
  const mock = await quietMock();
  const { socket, closed, opened } = connect(mock);
  await opened;
  socket.send(JSON.stringify(START));
  const { code, reason } = await closed;
  assert.strictEqual(code, 1011);
  assert.match(reason, /start is answered with started or error, and no WebSocket stub gives one/);
});

test('a stub is refused for a channel the mock doesn\'t serve, a message it doesn\'t receive, or something it may not send', async () => {
  const mock = await quietMock();
  const refused = async (body, pattern) => {
    const response = await stub(mock, body);
    assert.strictEqual(response.status, 422);
    assert.match((await response.json()).message, pattern);
  };
  await refused({ channel: 'nothing-asyncapi.yaml#/channels/audio', on: 'start' }, /isn't a channel of a document the mock serves/);
  await refused({ channel: CHANNEL, on: 'started' }, /isn't a message the mock receives/);
  await refused({ channel: CHANNEL, on: 'start', send: [{ type: 'start', audio: START.audio }] }, /send\.0" isn't a message the mock may send/);
  await refused({ channel: CHANNEL, on: 'start', respond: [] }, /unknown key|renamed/);
});

test('a scenario sends and receives on the relay, over the mock\'s WebSocket', async () => {
  const mock = await quietMock();
  const operations = new Map([...operationIndex(docs), ...controlOperations(mock)]);
  const relay = (key) => `$sourceDescriptions.relay.${key}`;
  const scenario = {
    arazzo: '1.1.0', info: { title: 't', version: '1' },
    sourceDescriptions: [
      { name: 'relay', url: '../base/domains/communication/communication-transcripts-relay-asyncapi.yaml', type: 'asyncapi' },
      { name: 'mock', url: 'https://blueprint.codeforamerica.org/mock/mock-openapi.yaml', type: 'openapi' },
    ],
    workflows: [{
      workflowId: 'w',
      steps: [
        { stepId: 'standIn', operationId: '$sourceDescriptions.mock.registerWsStub', requestBody: { payload: { channel: CHANNEL, on: 'start', send: [{ type: 'started' }] } }, successCriteria: [{ condition: '$statusCode == 201' }] },
        { stepId: 'standInForTheService', operationId: '$sourceDescriptions.mock.registerWsStub', requestBody: { payload: { channel: CHANNEL, on: 'audio', send: [RESULT] } } },
        { stepId: 'standInForTheEnd', operationId: '$sourceDescriptions.mock.registerWsStub', requestBody: { payload: { channel: CHANNEL, on: 'end', send: [{ type: 'ended' }] } } },
        { stepId: 'start', operationId: relay('receiveStart'), action: 'send', requestBody: { payload: START } },
        { stepId: 'started', operationId: relay('sendStarted'), action: 'receive' },
        { stepId: 'audio', operationId: relay('receiveAudio'), action: 'send', requestBody: { payload: '(audio)' } },
        { stepId: 'result', operationId: relay('sendResult'), action: 'receive',
          successCriteria: [{ condition: '$message.payload#/isFinal == true' }], outputs: { text: '$message.payload#/alternatives/0/transcript' } },
        { stepId: 'end', operationId: relay('receiveEnd'), action: 'send', requestBody: { payload: { type: 'end' } } },
        { stepId: 'ended', operationId: relay('sendEnded'), action: 'receive' },
      ],
    }],
  };
  const [run] = await runScenario(scenario, { fetch: mock.fetch, operations, WebSocket: mock.WebSocket });
  assert.ok(run.passed, JSON.stringify(run.steps.filter((s) => !s.passed).map((s) => [s.stepId, s.checks])));
  assert.deepStrictEqual(run.steps.find((s) => s.stepId === 'result').outputs, { text: 'Who lives with you?' });
  assert.deepStrictEqual(run.steps.find((s) => s.stepId === 'start').request, { action: 'send', channel: 'audio', message: 'start', document: 'base/domains/communication/communication-transcripts-relay-asyncapi.yaml', body: START });
});

test('a scenario step fails, saying why, when the mock closes the connection', async () => {
  const mock = await quietMock();
  const operations = new Map([...operationIndex(docs), ...controlOperations(mock)]);
  const scenario = {
    arazzo: '1.1.0', info: { title: 't', version: '1' },
    sourceDescriptions: [{ name: 'relay', url: '../base/domains/communication/communication-transcripts-relay-asyncapi.yaml', type: 'asyncapi' }],
    workflows: [{ workflowId: 'w', steps: [{ stepId: 'start', operationId: '$sourceDescriptions.relay.receiveStart', action: 'send', requestBody: { payload: START } }] }],
  };
  const [run] = await runScenario(scenario, { fetch: mock.fetch, operations, WebSocket: mock.WebSocket });
  assert.strictEqual(run.passed, false);
  assert.match(run.steps[0].checks[0].condition, /it closed: 1011 start is answered with started or error/);
});

test('a stub can drop the connection after what it sends, or answer only a connection that offered a token', async () => {
  const mock = await quietMock();
  await stub(mock, { channel: CHANNEL, on: 'audio', send: [RESULT], close: { code: 1006 } });
  const dropping = connect(mock);
  await dropping.opened;
  dropping.socket.send(new Uint8Array([1]));
  assert.deepStrictEqual(await dropping.closed, { code: 1006, reason: '' });
  assert.deepStrictEqual(dropping.heard, [RESULT], 'what it sent arrived before the drop');

  await stub(mock, { channel: CHANNEL, on: 'start', protocols: ['expired-token'], send: [{ type: 'error', code: 'not-allowed', message: 'The token has expired.' }], close: { code: 1008, reason: 'not-allowed' } });
  await stub(mock, { channel: CHANNEL, on: 'start', send: [{ type: 'started' }] });
  const good = new mock.WebSocket(URL_, ['blueprint.transcripts.relay.v1', 'good-token']);
  const goodHeard = [];
  good.addEventListener('message', (e) => goodHeard.push(JSON.parse(e.data)));
  await new Promise((settle) => good.addEventListener('open', settle));
  good.send(JSON.stringify(START));
  await tick();
  assert.deepStrictEqual(goodHeard, [{ type: 'started' }], 'the token stub was passed over for a connection without that token');

  const expired = new mock.WebSocket(URL_, ['blueprint.transcripts.relay.v1', 'expired-token']);
  const expiredHeard = [];
  expired.addEventListener('message', (e) => expiredHeard.push(JSON.parse(e.data)));
  const closed = new Promise((settle) => expired.addEventListener('close', (e) => settle(e.code)));
  await new Promise((settle) => expired.addEventListener('open', settle));
  expired.send(JSON.stringify(START));
  assert.strictEqual(await closed, 1008);
  assert.strictEqual(expiredHeard[0].code, 'not-allowed');
});

test('a scenario connects again by sending after the connection closed', async () => {
  const mock = await quietMock();
  const operations = new Map([...operationIndex(docs), ...controlOperations(mock)]);
  const relay = (key) => `$sourceDescriptions.relay.${key}`;
  const stubStep = (stepId, payload) => ({ stepId, operationId: '$sourceDescriptions.mock.registerWsStub', requestBody: { payload: { channel: CHANNEL, ...payload } }, successCriteria: [{ condition: '$statusCode == 201' }] });
  const scenario = {
    arazzo: '1.1.0', info: { title: 't', version: '1' },
    sourceDescriptions: [
      { name: 'relay', url: '../base/domains/communication/communication-transcripts-relay-asyncapi.yaml', type: 'asyncapi' },
      { name: 'mock', url: 'https://blueprint.codeforamerica.org/mock/mock-openapi.yaml', type: 'openapi' },
    ],
    workflows: [{
      workflowId: 'w',
      steps: [
        stubStep('first', { on: 'start', send: [{ type: 'started' }] }),
        stubStep('drop', { on: 'audio', send: [RESULT], close: { code: 1006 } }),
        stubStep('again', { on: 'start', send: [{ type: 'started' }] }),
        { stepId: 'start', operationId: relay('receiveStart'), action: 'send', requestBody: { payload: START } },
        { stepId: 'started', operationId: relay('sendStarted'), action: 'receive' },
        { stepId: 'audio', operationId: relay('receiveAudio'), action: 'send', requestBody: { payload: '(audio)' } },
        { stepId: 'lastResult', operationId: relay('sendResult'), action: 'receive' },
        { stepId: 'startAgain', operationId: relay('receiveStart'), action: 'send', requestBody: { payload: START } },
        { stepId: 'startedAgain', operationId: relay('sendStarted'), action: 'receive' },
      ],
    }],
  };
  const [run] = await runScenario(scenario, { fetch: mock.fetch, operations, WebSocket: mock.WebSocket });
  assert.ok(run.passed, JSON.stringify(run.steps.filter((s) => !s.passed).map((s) => [s.stepId, s.checks])));
});
