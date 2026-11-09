/**
 * The demo page: every part of live transcription working in one browser tab,
 * drawn as a sequence diagram that grows as things happen. Three lifelines —
 * the worker's browser, the state's server, and the transcription service
 * (or a relay in front of one) — with what the worker sees beside each row.
 * Each sentence is one row: the service hearing it and the browser saving it.
 * Click an arrow for what actually passed: the HTTP request and response, or
 * the protocol message.
 *
 * Two places, as a deployment has: the browser, here the page, with the
 * session in its mock; and the state's side, in a web worker
 * (server.worker.js), with the transcripts in its own mock and the fake relay.
 * Routing sends the transcript's calls from the page to the worker — the
 * browser-to-server arrows — and the page's mock follows the worker's event
 * stream, so the session hears its transcript. The driver works through the
 * SDK generated from the contracts. The service is either the fake adapter,
 * in the page, standing in for a vendor's adapter and the vendor, or the
 * relay adapter talking over a WebSocket to the fake relay in the worker.
 */

import { createMockServer } from '@codeforamerica/blueprint-mock-server/browser';
import { wrap } from '@codeforamerica/blueprint-mock-server/worker';
import contracts from '../../blueprint-harness/generated/mock/contracts.json';
import script from './interview.md';
import { recordingFromScript } from './script-to-recording.js';
import { createTranscriptionClient, createRelayAdapter, RELAY_PROTOCOL } from '../src/client/index.js';
import { createFakeAdapter, createWorkerWebSocket } from '../src/fakes/index.js';
// The SDK generated from the contracts (npm run sdk), as a developer generates theirs.
import * as sessions from '../generated/sdk/communication-transcription-sessions/index.ts';
import { client as sessionsClient } from '../generated/sdk/communication-transcription-sessions/client.gen.ts';
import * as events from '../generated/sdk/platform-events/index.ts';
import { client as eventsClient } from '../generated/sdk/platform-events/client.gen.ts';

/* global WORKER_SOURCE */

const $ = (id) => document.getElementById(id);
const AUDIO = { encoding: 'linear16', sampleRateHertz: 16000, channelCount: 1 };
const CALLER = { 'x-caller-id': 'demo-worker' };
const SPEAKERS = { spk_0: 'Worker', spk_1: 'Applicant' };

/** The lifelines, left to right. */
const LANES = ['browser', 'server', 'service'];
const center = (lane) => (2 * LANES.indexOf(lane) + 1) / 6;

let pageMock;
/** The state's side, in a worker: `server.fetch`, `server.connect`. */
let server;
let control;
let session = null;
let mode = 'fake';
let audio = null;
let drop = null;
/** Each sentence's row, by the service's key for it. */
let sentences = new Map();
/** Which sentence a finished line's text is, to put its save on its row. */
let keyByText = new Map();
let audioArrow = null;
let audioFrames = 0;
/** Stepping: what's waiting for Next, and whether a sentence just finished. */
let stepping = true;
let waiting = null;
/** Pressing Step to begin is itself the first step. */
let begun = false;
let sentenceDone = false;

/**
 * When stepping, wait for Next. The button says what comes next, so it's
 * clear what pressing it will do.
 */
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

/** The fakes' clock: when stepping, a finished sentence waits for Next. */
async function sleep(ms) {
  if (sentenceDone) {
    sentenceDone = false;
    await step('the next sentence');
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits for Next before the browser connects to the service. */
const stepped = (adapter) => ({
  async open(args) {
    await step('connect to the service');
    return adapter.open(args);
  },
});

const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pretty = (value) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));
const pathOf = (url) => decodeURIComponent(new URL(url).pathname);

/**
 * A row of the diagram: what the worker sees on the left, arrows on the
 * right. Clicking an arrow shows its details under the row.
 */
function row(worker = '', { className = '' } = {}) {
  const flow = $('flow');
  const el = document.createElement('div');
  el.className = 'row';
  el.innerHTML = `<div class="worker ${className}">${worker}</div><div class="lanes"></div><div class="detail" hidden></div>`;
  const atBottom = flow.scrollHeight - flow.scrollTop - flow.clientHeight < 60;
  flow.append(el);
  if (atBottom) flow.scrollTop = flow.scrollHeight;
  const lanes = el.querySelector('.lanes');
  const detail = el.querySelector('.detail');
  let shown = null;

  const r = {
    worker(html, cls = '') {
      const cell = el.querySelector('.worker');
      cell.innerHTML = html;
      cell.className = `worker ${cls}`;
      return r;
    },
    /** An arrow from one lifeline to another, or a note on one when `to` is null. */
    arrow(from, to, label, { warn = false } = {}) {
      const blocks = new Map();
      const wrap = document.createElement('div');
      wrap.className = 'step';
      const a = center(from);
      const b = to ? center(to) : a;
      const left = Math.min(a, b);
      const width = Math.abs(a - b);
      wrap.innerHTML = to
        ? `<button class="arrow ${b < a ? 'leftward' : ''} ${warn ? 'warn' : ''}" style="left:${left * 100}%;width:${width * 100}%"><span class="label"></span></button>`
        : `<button class="note ${warn ? 'warn' : ''}" style="left:${a * 100}%"><span class="label"></span></button>`;
      lanes.append(wrap);
      const button = wrap.querySelector('button');
      const show = () => {
        detail.hidden = false;
        detail.innerHTML = [...blocks].map(([k, v]) => `<h4>${escape(k)}</h4><pre>${escape(pretty(v))}</pre>`).join('');
        for (const other of el.querySelectorAll('button.open')) other.classList.remove('open');
        button.classList.add('open');
      };
      button.addEventListener('click', () => {
        if (shown === arrow) { shown = null; detail.hidden = true; button.classList.remove('open'); } else { shown = arrow; show(); }
      });
      const arrow = {
        label(text) { button.querySelector('.label').textContent = text; return arrow; },
        detail(k, v) { blocks.set(k, v); button.classList.add('has-detail'); if (shown === arrow) show(); return arrow; },
      };
      return arrow.label(label);
    },
  };
  return r;
}

/** A request and its response, as details on an arrow. */
async function exchange(arrow, request, answer) {
  const body = request.method === 'GET' ? null : await request.clone().text();
  const headers = [...request.headers].map(([k, v]) => `${k}: ${v}`).join('\n');
  arrow.detail('Request (HTTPS)', `${request.method} ${pathOf(request.url)}\n${headers}${body ? `\n\n${pretty(JSON.parse(body))}` : ''}`);
  const text = await answer.clone().text();
  arrow.detail('Response', `${answer.status}${text ? `\n\n${pretty(JSON.parse(text))}` : ''}`);
}

/**
 * A sentence the service hears: one row, its text growing on the left as the
 * service revises it, settling when the service finishes it.
 */
function hear(key, text, final, speakerLabel, message) {
  let sentence = sentences.get(key);
  if (!sentence) {
    const r = row();
    sentence = { row: r, heard: r.arrow('service', 'browser', ''), sent: [] };
    sentences.set(key, sentence);
  }
  const who = `<b>${SPEAKERS[speakerLabel] ?? 'Unknown'}</b> `;
  sentence.row.worker(`${who}${escape(text)}${final ? '' : '…'}`, final ? '' : 'progress');
  sentence.sent.push(`${final ? 'final  ' : 'partial'}  “${text}”`);
  sentence.heard.label(final ? 'heard' : 'hearing…')
    .detail('What the service sent for this sentence, in order',
      `${sentence.sent.join('\n')}\n\nEach partial result is the whole sentence so far and replaces the one before, so the worker sees words appear while the person is still talking. The final result is the settled text, and is the only one saved.`)
    .detail('The last message, as sent', message);
  if (final) { keyByText.set(text, key); sentenceDone = true; }
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
  return { state, chunks: chunks() };
}

/** The relay contract's messages, as they cross between browser and relay. */
function overTheWire(from, data) {
  const [a, b] = from === 'client' ? ['browser', 'service'] : ['service', 'browser'];
  if (typeof data !== 'string') {
    audioFrames += 1;
    if (!audioArrow) {
      audioArrow = row().arrow(a, b, '').detail('Audio', `Binary WebSocket frames of ${data.byteLength} bytes: 100 ms each of ${AUDIO.encoding} at ${AUDIO.sampleRateHertz} Hz. It keeps streaming while the rows below happen.`);
    }
    audioArrow.label(`audio, ${(audioFrames / 10).toFixed(0)} s`);
    return;
  }
  const message = JSON.parse(data);
  if (message.type === 'result') {
    hear(message.id, message.alternatives[0].transcript, message.isFinal, message.speaker, message);
    return;
  }
  // Keepalives come every few seconds while nothing else is said; they ride on the audio arrow.
  if (message.type === 'keepalive' && audioArrow) { audioArrow.detail('Latest keepalive', message); return; }
  const label = { start: 'start', started: 'started', end: 'end', ended: 'ended', keepalive: 'keepalive' }[message.type] ?? message.type;
  row().arrow(a, b, label, { warn: message.type === 'error' }).detail(`Message (${RELAY_PROTOCOL})`, message);
}

/** The fake adapter, as the service it stands in for, with a way to drop its connection. */
function fakeAdapter(recording, speed) {
  const fake = createFakeAdapter(recording, { speed, sleep });
  return {
    async open(args) {
      row().arrow('browser', 'service', 'connect')
        .detail('How', `A WebSocket to ${args.connection.url}, the address the server answered with. The stand-in doesn't open it; it plays a recording. A real adapter does: for Amazon Transcribe, the address itself carries a signed credential that expires in ${args.connection.expiresIn} seconds, and audio and results then pass over that socket in Transcribe's own binary format.`)
        .detail('What the server answered', args.connection);
      const report = {
        update: (line) => { hear(line.key, line.text, false, line.speakerLabel, line); args.report.update(line); },
        add: (line) => { hear(line.key, line.text, true, line.speakerLabel, line); args.report.add(line); },
        dropped: () => {
          row().arrow('service', 'browser', 'connection dropped', { warn: true })
            .detail('What passed', 'Nothing: the connection closed without the browser asking. The browser will ask the server for a fresh pass and reconnect.');
          args.report.dropped();
        },
      };
      const handle = await fake.open({ ...args, report });
      drop = async () => { await handle.finish(); report.dropped(); };
      return {
        finish: async () => {
          row().arrow('browser', 'service', 'disconnect')
            .detail('What passed', 'Nothing here: the stand-in plays a recording and just stops. A real vendor is told the audio is over in its own way. Amazon Transcribe, for one, gets an empty audio message, sends its last results, and closes.');
          await handle.finish();
        },
      };
    },
  };
}

/** The driver's calls to the session stay in the browser; only refusals are shown. */
async function driverCall(request) {
  const response = await pageMock.fetch(request);
  if (!response.ok) {
    const { message } = await response.clone().json().catch(() => ({}));
    row().arrow('browser', null, `refused: ${message ?? response.status}`, { warn: true });
  }
  return response;
}

/**
 * The session's calls to the transcript, as arrows from browser to server. A
 * sentence's save goes on that sentence's row.
 */
function transcriptArrow(request, body) {
  const path = pathOf(request.url);
  if (path.endsWith('/entries') && body?.text) {
    const sentence = sentences.get(keyByText.get(body.text));
    if (sentence) return sentence.row.arrow('browser', 'server', 'save');
    return row(`<b>${SPEAKERS[body.speaker] ?? ''}</b> ${escape(body.text)}`).arrow('browser', 'server', 'save');
  }
  if (path.endsWith('/entries') && body?.kind === 'gap') return row('Nothing captured while the connection was down', { className: 'gap' }).arrow('browser', 'server', 'record the gap');
  if (path.endsWith('/pause')) return row('Off the record', { className: 'aside' }).arrow('browser', 'server', 'pause');
  if (path.endsWith('/resume')) return row('Back on the record', { className: 'aside' }).arrow('browser', 'server', 'resume');
  const label = request.method === 'POST' && path.endsWith('/transcripts') ? 'start a transcript'
    : path.endsWith('/get-connection') ? 'how do I reach the service?'
      : path.endsWith('/renew-connection') ? 'fresh pass, please'
        : path.endsWith('/close') ? 'close the transcript'
          : `${request.method} ${path}`;
  return row().arrow('browser', 'server', label);
}

function showMode() {
  $('service-lane').textContent = mode === 'relay' ? 'Relay (stand-in)' : 'Service (stand-in)';
}

async function start() {
  if (audio) audio.state.done = true;
  next();
  sentenceDone = false;
  sentences = new Map();
  keyByText = new Map();
  audioArrow = null;
  audioFrames = 0;
  $('flow').innerHTML = '';
  drawFollowing();
  mode = $('mode').value;
  showMode();
  const speed = Number($('speed').value);
  const recording = recordingFromScript(script);

  let adapters;
  if (mode === 'relay') {
    await configureRelay(speed);
    const Base = createWorkerWebSocket(() => server.connect('relay'), { tap: overTheWire });
    adapters = {
      [RELAY_PROTOCOL]: stepped(createRelayAdapter({
        WebSocket: class extends Base {
          constructor(url, protocols) {
            super(url, protocols);
            audioArrow = null;
            row().arrow('browser', 'service', 'connect')
              .detail('How', `A WebSocket to ${url}, the address the server answered with. Audio goes over it as binary frames and everything else as JSON messages, as the relay contract says.\n\nSec-WebSocket-Protocol: ${[].concat(protocols).join(', ')}\n\nThe token travels beside the subprotocol, not in the URL, which servers log.`);
            drop = () => {
              row().arrow('service', 'browser', 'connection dropped', { warn: true }).detail('What passed', 'The socket closed without an end message. The browser will ask the server for a fresh pass and reconnect.');
              this.close();
            };
          }
        },
      })),
    };
  } else {
    adapters = { default: stepped(fakeAdapter(recording, speed)) };
  }

  const client = createTranscriptionClient({
    sessions,
    events,
    fetch: driverCall,
    audio: AUDIO,
    adapters,
    speakerFor: (label) => ({ spk_0: 'staff', spk_1: 'client' })[label] ?? 'unknown',
    retryDelay: () => 1500,
    onError: (error) => row().arrow('browser', null, error.message, { warn: true }),
  });

  const profile = await serverCall('POST', '/communication/profiles', {
    name: `demo-${Date.now()}`, provider: mode === 'relay' ? 'google-cloud-speech' : 'aws-transcribe', languages: ['en-US'],
  });
  session = await client.start({ profileId: profile.id, model: 'standard', client: 'blueprint-transcription-demo/0.1.0', startedAt: new Date().toISOString() });
  audio = silence();
  refresh();
  await session.connect(audio.chunks);
  refresh();
}

const act = (name) => async () => {
  try {
    if (name === 'drop') await drop?.();
    else await session[name]();
    if (name === 'stop' && audio) audio.state.done = true;
  } catch (error) {
    row().arrow('browser', null, error.message, { warn: true });
  }
  refresh();
};

const serverCall = async (method, path, body) => (await server.fetch(new Request(`http://localhost${path}`, {
  method, headers: { 'content-type': 'application/json', ...CALLER }, body: body && JSON.stringify(body),
}))).json();

/**
 * The page's mock reads the server's event stream from the moment the page
 * opens; each run's diagram starts with it.
 */
let following = null;
function drawFollowing() {
  if (!following) return;
  row().arrow('browser', 'server', 'follow the transcript\'s events')
    .detail('Request (HTTPS)', following)
    .detail('Why', 'The session runs here, in the browser; its transcript is on the server. The session follows the transcript: paused or closed by someone else, it pauses or closes too. So the browser\'s mock reads the server\'s event stream, open since the page loaded, and handles each event as its own.');
}

/** The worker's relay plays at this speed for the run about to start. */
function configureRelay(speed) {
  return new Promise((resolve) => {
    configured = resolve;
    control.postMessage({ type: 'configure', speed });
  });
}
let configured = null;

/**
 * The worker's relay asks before each wait in its recording; after a finished
 * sentence, when stepping, the answer waits for Next.
 */
function answerControl({ data: message }) {
  if (message.type === 'configured') {
    configured?.();
  } else if (message.type === 'sleep') {
    sleep(0).then(() => control.postMessage({ type: 'go', id: message.id }));
  }
}

/**
 * The server's events, as they stream to the page's mock: the ones about the
 * transcript are drawn as they arrive, the rest pass by.
 */
function watchEvents(response) {
  const [mine, theirs] = response.body.tee();
  (async () => {
    const reader = mine.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += value;
      let end;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = block.match(/^data: (.*)$/m)?.[1];
        if (!data) continue;
        const event = JSON.parse(data);
        const what = event.type.split('.').pop();
        if (!['paused', 'resumed', 'closed'].includes(what)) continue;
        row(`The transcript is ${what === 'resumed' ? 'back on the record' : what}`, { className: 'aside' })
          .arrow('server', 'browser', `transcript ${what}`)
          .detail('The event, as the server streamed it', event);
      }
    }
  })().catch(() => {});
  return new Response(theirs, { status: response.status, headers: response.headers });
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
  const status = session?.status ?? 'none';
  const startable = canStart();
  $('step').disabled = !startable && !waiting;
  $('run').disabled = !startable && !stepping;
  const allowed = {
    pause: status === 'connected',
    resume: status === 'paused',
    drop: status === 'connected',
    stop: ['connected', 'paused', 'disconnected'].includes(status),
  };
  for (const [name, on] of Object.entries(allowed)) $(name).disabled = !on;
  $('mode').disabled = !startable;
  $('speed').disabled = stepping && !startable;
}

async function boot() {
  const quiet = { log: console.log, warn: console.warn };
  console.log = () => {}; console.warn = () => {};
  try {
    // The state's side, in a worker; a page opened from disk starts one from a blob.
    server = wrap(new Worker(URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }))));
    control = await server.connect('control');
    control.onmessage = answerControl;
    // The browser: the session, with everything else in its domain routed to the server.
    pageMock = await createMockServer({
      contracts,
      routing: [{
        domain: 'communication',
        except: [{ api: 'communication-transcription-sessions' }],
        handler: async (request) => {
          // Events the server's machines react to; the server publishes its own.
          if ((request.headers.get('content-type') ?? '').includes('cloudevents')) return new Response(null, { status: 202 });
          const path = pathOf(request.url);
          // The page's mock following the server's events: one arrow, then
          // each event about the transcript as it arrives.
          if (path === '/platform/events/stream') {
            following = `GET ${path}${new URL(request.url).search}\nAccept: text/event-stream`;
            drawFollowing();
            return watchEvents(await server.fetch(request));
          }
          const body = request.method === 'GET' ? null : await request.clone().json().catch(() => null);
          // When stepping, the calls that set things up wait for Next; the
          // ones a button made, and a sentence's save, don't.
          if (request.method === 'POST' && path.endsWith('/transcripts')) await step('start a transcript');
          else if (path.endsWith('/get-connection') || path.endsWith('/renew-connection')) await step('ask the server how to reach the service');
          const arrow = transcriptArrow(request, body);
          // Forward a copy: forwarding reads the body, and the details need it after.
          const response = await server.fetch(request.clone());
          await exchange(arrow, request, response);
          return response;
        },
      }],
    });
  } finally { Object.assign(console, quiet); }
  // The driver's SDK reaches the page's mock, where the session runs.
  for (const [client, base] of [[sessionsClient, 'communication'], [eventsClient, 'platform']]) {
    client.setConfig({ baseUrl: `http://localhost/${base}`, fetch: driverCall, headers: CALLER });
  }

  const begin = () => {
    running = true;
    session = null;
    start().catch((error) => {
      running = false;
      row().arrow('browser', null, error.message, { warn: true });
    });
  };
  $('step').addEventListener('click', () => { stepping = true; if (canStart()) { begun = true; begin(); } else next(); refresh(); });
  $('run').addEventListener('click', () => { stepping = false; if (canStart()) begin(); else next(); refresh(); });
  $('mode').addEventListener('change', () => { mode = $('mode').value; showMode(); });
  for (const name of ['pause', 'resume', 'drop', 'stop']) $(name).addEventListener('click', act(name));
  $('loading').hidden = true;
  // The session changes on its own too — a drop, a reconnect — so the
  // buttons follow it.
  setInterval(refresh, 250);
  refresh();
}

boot();
