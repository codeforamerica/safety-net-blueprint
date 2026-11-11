/**
 * The demo page: every part of live transcription working in one browser tab,
 * drawn as a sequence diagram that grows as things happen. Five lifelines:
 *
 * - Your code: what a developer writes, which sets the mocks up and calls
 *   the transcription client;
 * - Client SDK: the transcription client, with the SDK generated from the
 *   contracts and the client adapter;
 * - Mock client: the session, in the page;
 * - Mock server: the transcript, standing in for the state's server;
 * - Transcription service: Amazon Transcribe, played by a fake socket
 *   (fake-transcribe.js) so no AWS account is needed.
 *
 * Every arrow is something that crossed, named as the contracts name it, with
 * a caption saying what happened. Click an arrow for what passed; hover a
 * name for its declaration.
 */

import { createMockServer } from '@codeforamerica/blueprint-mock-server/server';
import { createMockClient } from '@codeforamerica/blueprint-mock-server/client';
import { createSequence } from '@codeforamerica/blueprint-explorer/sequence';
import contracts from '../../blueprint-harness/generated/mock/contracts.json';
import script from './interview.md';
import { recordingFromScript } from './script-to-recording.js';
import { SCENARIOS } from './scenarios.js';
import { createFakeTranscribe } from './fake-transcribe.js';
import { createTranscriptionClient, createAwsTranscribeAdapter } from '../src/client/index.js';
import { createTranscriptsAdapter, awsTranscribeIssuer } from '../src/server/index.js';
// The SDK generated from the contracts (npm run sdk), as a developer generates theirs.
import * as sessions from '../generated/sdk/communication-transcription-sessions/index.ts';
import { client as sessionsClient } from '../generated/sdk/communication-transcription-sessions/client.gen.ts';
import * as transcripts from '../generated/sdk/communication-transcripts/index.ts';
import { client as transcriptsClient } from '../generated/sdk/communication-transcripts/client.gen.ts';
import * as events from '../generated/sdk/platform-events/index.ts';
import { client as eventsClient } from '../generated/sdk/platform-events/client.gen.ts';

/* global REFS */

const $ = (id) => document.getElementById(id);
const AUDIO = { encoding: 'linear16', sampleRateHertz: 16000, channelCount: 1 };
const CALLER = { 'x-caller-id': 'worker-1' };
/** How fast a recording plays. */
const SPEED = 1.5;
/** The relay scenario is drawn next; until then, the ones straight to Transcribe. */
const PLAYABLE = SCENARIOS.filter((s) => s.via !== 'relay');

/** A name's declaration, found at build time (scripts/build-demo.js), for the hover card. */
const refsFor = (...names) => names.map((name) => REFS[name]).filter(Boolean);

const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const short = (s) => String(s).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (m) => `${m.slice(0, 8)}…`);
const pretty = (text) => { try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; } };
const clip = (text) => short(text.length > 1500 ? `${text.slice(0, 1500)}…` : text);
const pathOf = (url) => { const u = new URL(url); return decodeURIComponent(u.pathname + u.search); };
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

/** The diagram (the explorer's sequence view). */
let sequence;
let phases = 0;

/** One arrow, or a note when `from` and `to` are the same, on a row of its own. */
function draw(from, to, kind, text, caption = '', { details = {}, refs = refsFor(text), warn = false } = {}) {
  if (from === to) return sequence.note({ over: from, text, caption, details, refs, warn });
  return sequence.message({ from, to, kind, text, caption, details, refs, warn });
}

/** A heading row for what happens next. */
function phase(title) {
  phases += 1;
  sequence.row({ caption: { who: `${phases}. ${title}`, text: '' } });
}

/** The operation a request is, by its path. */
function operationOf(method, path) {
  const p = path.split('?')[0];
  if (p.startsWith('/platform/events/stream')) return 'streamEvents';
  if (p === '/communication/transcription-sessions') return 'createTranscriptionSession';
  let m = p.match(/^\/communication\/transcription-sessions\/[^/]+(?:\/([a-z-]+))?$/);
  if (m) return m[1] ? `${camel(m[1])}TranscriptionSession` : 'getTranscriptionSession';
  if (p === '/communication/transcripts') return 'createTranscript';
  m = p.match(/^\/communication\/transcripts\/[^/]+(?:\/([a-z-]+))?$/);
  if (m) return m[1] ? ({ entries: 'addTranscriptEntry' }[m[1]] ?? `${camel(m[1])}Transcript`) : 'getTranscript';
  return `${method} ${p}`;
}

const requestDetail = async (request, keep = []) => {
  const path = pathOf(request.url);
  const body = ['GET', 'HEAD'].includes(request.method) ? '' : await request.clone().text();
  const headers = [...request.headers].filter(([k]) => keep.includes(k)).map(([k, v]) => `\n${k}: ${v}`).join('');
  return clip(`${request.method} ${path}${headers}${body ? `\n\n${pretty(body)}` : ''}`);
};

/** The events that the session's state machine reacts to. */
const REACTS = new Set(['communication.transcript.paused', 'communication.transcript.closed']);

/**
 * Each event as it arrives on a stream, drawn, and the stream handed on as it
 * came.
 */
function tapStream(response, from, to) {
  const [mine, theirs] = response.body.tee();
  (async () => {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of mine) {
      buffer += decoder.decode(chunk, { stream: true });
      let at;
      while ((at = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
        if (!data) continue;
        const event = JSON.parse(data);
        const what = event.type.split('.').pop();
        const reacts = REACTS.has(event.type);
        const caption = from === 'server'
          ? `The transcript's ${what} event arrives on the mock client's subscription. ${reacts ? 'The session\'s state machine reacts to it.' : 'Nothing in the client reacts to it, so it goes no further.'}`
          : `The session's ${what} event arrives on the transcription client's subscription.`;
        draw(from, to, 'async', event.type, caption, {
          details: { Event: short(JSON.stringify({ id: event.id, type: event.type, subject: event.subject, data: event.data }, null, 2)) },
          refs: refsFor(event.type, ...(reacts && from === 'server' ? [`on ${event.type}`] : [])),
        });
      }
    }
  })().catch(() => {});
  return new Response(theirs, { status: response.status, headers: response.headers });
}

// ---------------------------------------------------------------------------
// The page's setup: what your code writes, as the first phase of each run
// shows it.

/** The mock server's stream request, from the mock client following it. */
let following = null;
let mockServer;
let mockClient;
let profile;

const SETUP_SERVER = `const server = await createMockServer({
  contracts,
  routing: [{
    operation: 'issueTranscriptConnection',
    handler: createTranscriptsAdapter({
      issuers: { 'aws-transcribe': awsTranscribeIssuer({ region, credentials }) },
    }),
  }],
});`;

const SETUP_CLIENT = `const client = await createMockClient({
  contracts,
  routing: [{
    domain: '*',
    handler: server.fetch,   // a real deployment: to: 'https://…', includeHeaders: ['Authorization']
    except: [{ api: 'communication-transcription-sessions' }, { api: 'platform-events' }],
  }],
});`;

const SETUP_TRANSCRIPTION = `sessionsClient.setConfig({ baseUrl: '/communication', fetch: client.fetch });
transcriptsClient.setConfig({ baseUrl: '/communication', fetch: client.fetch });
eventsClient.setConfig({ baseUrl: '/platform', fetch: client.fetch });

const transcription = createTranscriptionClient({
  sessions, transcripts, events, fetch: client.fetch,
  adapters: { 'aws-transcribe': createAwsTranscribeAdapter() },
});`;

/**
 * The state's transcripts adapter, from the transcription package's server
 * side, which signs a URL straight to Amazon Transcribe. It runs in the page
 * here only because the mock server does; a state runs it on its server,
 * where the secret is. The key is AWS's documented example key.
 */
const issue = createTranscriptsAdapter({
  issuers: {
    'aws-transcribe': awsTranscribeIssuer({
      region: 'us-east-1',
      credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' },
      settings: { 'show-speaker-label': 'true' },
    }),
  },
});

async function setUp() {
  mockServer = await createMockServer({
    contracts,
    routing: [{
      operation: 'issueTranscriptConnection',
      handler: async (request) => {
        draw('server', 'code', 'call', 'issueTranscriptConnection', 'The transcript\'s get-connection action calls the state\'s transcripts adapter, which your code gave the mock server. The profile\'s provider is aws-transcribe, so it signs a URL straight to Amazon Transcribe.', {
          details: { Request: await requestDetail(request) },
        });
        const response = await issue(request);
        draw('code', 'server', 'reply', String(response.status), 'The adapter answers with the signed URL. It holds the AWS secret; only the short-lived signed URL leaves it.', {
          details: { Response: clip(pretty(await response.clone().text())) },
        });
        return response;
      },
    }],
  });

  mockClient = await createMockClient({
    contracts,
    routing: [{
      domain: '*',
      except: [{ api: 'communication-transcription-sessions' }, { api: 'platform-events' }],
      handler: async (request) => {
        const path = pathOf(request.url);
        const op = operationOf(request.method, path);
        const detail = await requestDetail(request, ['authorization', 'idempotency-key', 'x-caller-id', 'accept', 'last-event-id']);
        if (op === 'streamEvents') {
          following = detail;
          drawFollowing();
          return tapStream(await mockServer.fetch(request), 'server', 'client');
        }
        draw('client', 'server', 'call', op, `The session's action calls the mock server's ${op}, as the caller.`, { details: { Request: detail } });
        const response = await mockServer.fetch(request);
        draw('server', 'client', 'reply', String(response.status), '', {
          details: { Response: clip(pretty(await response.clone().text())) },
          refs: [],
          warn: !response.ok,
        });
        return response;
      },
    }],
  });

  // A profile the state set up on the server, before any of this.
  profile = await (await mockServer.fetch(new Request('http://localhost/communication/profiles', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-caller-id': 'admin-1' },
    body: JSON.stringify({ name: 'english', provider: 'aws-transcribe', languages: ['en-US'] }),
  }))).json();
}

/** The mock client follows the mock server's events from the start; each run's diagram shows it. */
function drawFollowing() {
  if (!following || !sequence) return;
  draw('client', 'server', 'async', 'streamEvents', 'The mock client subscribes to the events it reacts to: here, the transcript\'s. The stream stays open.', {
    details: { Request: following },
  });
}

/**
 * The transcription client's calls, through the generated SDK, to the mock
 * client: each drawn with its answer.
 */
async function sdkFetch(request) {
  const op = operationOf(request.method, pathOf(request.url));
  if (op !== 'streamEvents') {
    calling += 1;
    try { return await sdkCall(request, op); } finally { calling -= 1; }
  }
  return sdkCall(request, op);
}

/** How many of the transcription client's calls haven't answered yet. */
let calling = 0;

/** Once the transcription client's calls have all answered: a sentence saved, say. */
async function settled() {
  do await new Promise((resolve) => setTimeout(resolve, 20));
  while (calling > 0);
}

async function sdkCall(request, op) {
  const detail = await requestDetail(request);
  if (op === 'streamEvents') {
    draw('sdk', 'client', 'async', 'streamEvents', 'The transcription client subscribes to this session\'s events, through the events SDK. The stream stays open.', { details: { Request: detail } });
    return tapStream(await mockClient.fetch(request), 'client', 'sdk');
  }
  draw('sdk', 'client', 'call', op, `The transcription client calls the sessions SDK's ${op}. The mock client answers.`, { details: { Request: detail } });
  const response = await mockClient.fetch(request);
  const text = await response.clone().text();
  draw('client', 'sdk', 'reply', String(response.status), response.ok ? '' : `Refused: ${JSON.parse(text || '{}').message ?? response.statusText}`, {
    details: { Response: clip(pretty(text)) },
    refs: [],
    warn: !response.ok,
  });
  return response;
}

// ---------------------------------------------------------------------------
// Stepping through a scenario.

/**
 * A heading waiting for what it heads: drawn with the next thing the service
 * sends, so it sits above the sentence rather than the last one's saving.
 */
let heading = null;
const headed = () => { if (heading) { phase(heading); heading = null; } };

/** The scenario playing (scenarios.js), and how far through its beats. */
let scenario = PLAYABLE[0];
let beat = 0;
let session = null;
let audio = null;
/** Stepping: what's waiting for Next, and whether a sentence just finished. */
let stepping = true;
let waiting = null;
/** Pressing Step to begin is itself the first step. */
let begun = false;
let sentenceDone = false;

/** When stepping, wait for Next. The button says what comes next. */
function step(what) {
  if (!stepping) return undefined;
  if (begun) { begun = false; return undefined; }
  return new Promise((resolve) => {
    waiting = resolve;
    $('upcoming').textContent = `Next: ${what}`;
    refresh();
  });
}

function next() {
  const go = waiting;
  waiting = null;
  $('upcoming').textContent = '';
  go?.();
}

/** What each of a scenario's beats is called, as Next names it and as its heading says. */
const BEATS = {
  say: ['the next sentence', 'Someone speaks'],
  drop: ['the connection drops', 'The connection drops and comes back'],
  pause: ['go off the record', 'Off the record'],
  resume: ['go back on the record', 'Back on the record'],
  stop: ['finish', 'Stop'],
  'pause-elsewhere': ['someone else pauses the transcript', 'Someone else pauses the transcript'],
};

/**
 * The fake service's clock, which is where the scenario moves on: after each
 * finished sentence, the next beats. A drop is in the recording, so it plays
 * on; your code's beats run here, and the recording waits until they close
 * the connection or open a new one.
 */
async function sleep(ms) {
  if (sentenceDone) {
    sentenceDone = false;
    await settled();
    beat += 1;
    const now = scenario.beats[beat];
    if (now === 'drop') {
      beat += 1;
      await step(BEATS.drop[0]);
      heading = BEATS.drop[1];
    } else if (now && now !== 'say') {
      runBeats();
      return new Promise(() => {});
    } else if (now === 'say') {
      await step(BEATS.say[0]);
      heading = BEATS.say[1];
    }
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** The scenario's beats from here to its next sentence, one step each. */
async function runBeats() {
  while (scenario.beats[beat] && !['say', 'drop'].includes(scenario.beats[beat])) {
    const action = scenario.beats[beat];
    beat += 1;
    await step(BEATS[action][0]);
    phase(BEATS[action][1]);
    try {
      await perform(action);
    } catch (error) {
      draw('code', 'code', 'note', error.message, '', { warn: true, refs: [] });
    }
    refresh();
  }
  if (scenario.beats[beat] === 'say') heading = BEATS.say[1];
}

/** Your code's call to the session, drawn with its answer. */
async function call(name, caption, code, run) {
  draw('code', 'sdk', 'call', name, caption, { details: { Code: code }, refs: [] });
  await run();
  draw('sdk', 'code', 'reply', session.status, '', { refs: [] });
}

async function perform(action) {
  if (action === 'pause') await call('pause', 'Your code goes off the record.', 'await session.pause();', () => session.pause());
  else if (action === 'resume') await call('resume', 'Your code goes back on the record, with the same audio.', 'await session.resume();', () => session.resume());
  else if (action === 'stop') {
    await call('stop', 'Your code finishes.', 'await session.stop();', () => session.stop());
    audio.state.done = true;
  } else if (action === 'pause-elsewhere') {
    await pauseElsewhere();
  }
}

/**
 * A supervisor pauses the transcript on the server, with nothing in the page
 * asking. The session follows its transcript, and the transcription client
 * closes the connection.
 */
async function pauseElsewhere() {
  const request = new Request(`http://localhost/communication/transcripts/${session.record.transcriptId}/pause`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-caller-id': 'supervisor-1' },
    body: JSON.stringify({ at: new Date().toISOString() }),
  });
  draw('server', 'server', 'note', 'pauseTranscript', 'A supervisor pauses the transcript on the mock server, from another app. Nothing in this page asked.', {
    details: { Request: await requestDetail(request, ['x-caller-id']) },
  });
  await mockServer.fetch(request);
}

/** The page's audio: silence, since the words come from a recorded interview. */
function silence() {
  const state = { done: false };
  async function* chunks() {
    const chunk = new Uint8Array(3200); // 100 ms of 16 kHz, 16-bit mono
    while (!state.done) {
      yield chunk;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  // Read afresh by each connection, as captureAudio's chunks are: an adapter
  // stops reading when its connection closes, which would end a lone generator.
  return { state, chunks: { [Symbol.asyncIterator]: chunks }, audio: AUDIO };
}

/** What crosses between the Amazon Transcribe adapter and Transcribe, drawn. */
function transcribeTap() {
  let audioArrow = null;
  let frames = 0;
  return (what, detail) => {
    if (what === 'open') {
      audioArrow = null;
      frames = 0;
      const url = new URL(detail.url);
      const query = [...url.searchParams].map(([k, v]) => `${k}=${/^X-Amz-(Credential|Signature|Security-Token)$/.test(k) ? `${v.slice(0, 12)}…` : v}`).join('\n');
      draw('sdk', 'service', 'call', 'new WebSocket', 'The Amazon Transcribe adapter opens a WebSocket to the signed URL the server answered with.', { details: { URL: `${url.origin}${url.pathname}\n${query}` } });
    } else if (what === 'audio') {
      frames += 1;
      if (!audioArrow) {
        audioArrow = draw('sdk', 'service', 'async', 'AudioEvent', 'Audio, as AudioEvent messages in AWS\'s event stream format: 100 ms each, for as long as the connection is open. One arrow stands for them all.', {
          details: { Each: `${detail.bytes} bytes of ${AUDIO.encoding} at ${AUDIO.sampleRateHertz} Hz` },
        });
      }
      audioArrow.update({ text: `AudioEvent ×${frames}` });
    } else if (what === 'end') {
      draw('sdk', 'service', 'async', 'AudioEvent (empty)', 'An empty AudioEvent: the audio is over. Transcribe sends its last results and closes.');
    } else if (what === 'result') {
      headed();
      const { result } = detail;
      draw('service', 'sdk', 'async', 'TranscriptEvent', result.IsPartial
        ? `A result that's still changing: "${result.Alternatives[0].Transcript}".`
        : `A finished result: "${result.Alternatives[0].Transcript}".`, { details: { Result: JSON.stringify(result, null, 2) } });
      if (!result.IsPartial) sentenceDone = true;
    } else if (what === 'close') {
      if (!detail.finished) headed();
      draw('service', 'sdk', 'async', 'close', detail.finished ? 'Transcribe closes the connection.' : 'The connection drops: the network went away.', { warn: !detail.finished });
    }
  };
}

async function start() {
  if (audio) audio.state.done = true;
  next();
  sentenceDone = false;
  scenario = PLAYABLE.find((s) => s.id === $('scenario').value) ?? PLAYABLE[0];
  beat = 0;
  phases = 0;
  heading = null;
  sequence.clear();

  phase('The page starts');
  draw('code', 'code', 'note', 'createMockServer', 'Your code creates the mock server. It stands in for the state\'s server, and its routing sends issueTranscriptConnection to the transcripts adapter your code gives it.', { details: { Code: SETUP_SERVER } });
  draw('code', 'code', 'note', 'createMockClient', 'Your code creates the mock client. It runs the session API and the page\'s event log in the page, and sends everything else to the mock server.', { details: { Code: SETUP_CLIENT } });
  drawFollowing();
  draw('code', 'code', 'note', 'createTranscriptionClient', 'Your code points the generated SDKs at the mock client, and creates the transcription client with the client adapters it can connect with, by service: here, the Amazon Transcribe adapter.', { details: { Code: SETUP_TRANSCRIPTION } });

  const FakeTranscribe = createFakeTranscribe(recordingFromScript(script, { beats: scenario.beats }), { speed: SPEED, sleep, tap: transcribeTap() });
  const transcription = createTranscriptionClient({
    sessions,
    transcripts,
    events,
    fetch: sdkFetch,
    adapters: { 'aws-transcribe': createAwsTranscribeAdapter({ WebSocket: FakeTranscribe }) },
    speakerFor: (label) => ({ spk_0: 'staff', spk_1: 'client' })[label] ?? 'unknown',
    retryDelay: () => 1500,
    onError: (error) => draw('sdk', 'sdk', 'note', error.message, '', { warn: true, refs: [] }),
  });

  await step('start a session');
  phase('Start');
  const fields = { profileId: profile.id, model: 'standard', client: 'interview-assistant/0.1.0', startedAt: new Date().toISOString() };
  draw('code', 'sdk', 'call', 'start', 'Your code starts a session, with a profile the state set up on the server (provider: aws-transcribe).', {
    details: { Code: short(`const session = await transcription.start(${JSON.stringify(fields, null, 2)});`) },
    refs: [],
  });
  session = await transcription.start(fields);
  draw('sdk', 'code', 'reply', 'session', 'Your code gets the session object.', { refs: [] });
  refresh();

  await step('connect');
  phase('Connect');
  audio = silence();
  await call('connect', 'Your code hands over the audio: here, silence, since the words come from a recorded interview.', 'const capture = await captureAudio({ sharedAudio: true });\nawait session.connect(capture);', () => session.connect(audio));
  heading = BEATS.say[1];
  refresh();
}

/**
 * A new run can start once the last one ended: from the first click, until its
 * session closes or fails, or it couldn't start at all.
 */
let running = false;
function canStart() {
  if (running && ['closed', 'failed'].includes(session?.status)) running = false;
  return !running;
}

function refresh() {
  const startable = canStart();
  $('step').disabled = !startable && !waiting;
  $('run').disabled = !startable && !stepping;
  $('scenario').disabled = !startable;
}

async function boot() {
  sequence = createSequence($('flow'), {
    captionTitle: 'What happens',
    participants: [
      { id: 'code', name: 'Your code' },
      { id: 'sdk', name: 'Client SDK' },
      { id: 'client', name: 'Mock client' },
      { id: 'server', name: 'Mock server' },
      { id: 'service', name: 'Transcription service' },
    ],
  });
  const quiet = { log: console.log, warn: console.warn };
  console.log = () => {}; console.warn = () => {};
  try {
    await setUp();
  } finally { Object.assign(console, quiet); }
  // The generated SDKs reach the mock client, where the session runs.
  for (const [client, base] of [[sessionsClient, 'communication'], [transcriptsClient, 'communication'], [eventsClient, 'platform']]) {
    client.setConfig({ baseUrl: `http://localhost/${base}`, fetch: sdkFetch, headers: CALLER });
  }

  const begin = () => {
    running = true;
    session = null;
    start().catch((error) => {
      running = false;
      draw('code', 'code', 'note', error.message, '', { warn: true, refs: [] });
    });
  };
  $('step').addEventListener('click', () => { stepping = true; if (canStart()) { begun = true; begin(); } else next(); refresh(); });
  $('run').addEventListener('click', () => { stepping = false; if (canStart()) begin(); else next(); refresh(); });
  $('scenario').innerHTML = PLAYABLE.map((s) => `<option value="${s.id}">${escape(s.title)}</option>`).join('');
  const describe = () => { $('summary').textContent = PLAYABLE.find((s) => s.id === $('scenario').value).summary; };
  $('scenario').addEventListener('change', describe);
  describe();
  $('loading').hidden = true;
  // The session changes on its own too — a drop, a reconnect — so the
  // buttons follow it.
  setInterval(refresh, 250);
  refresh();
}

boot();
