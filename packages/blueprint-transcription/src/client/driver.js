/**
 * The driver: the one part of transcription software that talks to the
 * transcription session. A client adapter speaks one service's protocol and
 * reports what happens; the driver turns each report into the session's
 * action, so no adapter holds any session logic and every adapter works the
 * same way. See docs/architecture/cross-cutting/browser-vendor-stream.md.
 *
 * It calls the session's actions through the session's SDK, generated from
 * the contracts (blueprint-generate-ts-clients --http-client=fetch), and follows
 * the session's events through the platform's events SDK: the page generates
 * both from its contracts and configures their clients — where they're
 * served, who's calling, and in a page, the in-page mock's fetch.
 *
 * A client adapter is an object with:
 *   - `open({ connection, chunks, audio, report })`: open a connection with
 *     what get-connection answered, stream `chunks` (the capture's audio,
 *     passed through untouched, in the AudioFormat `audio`), and resolve with
 *     a handle once it's open.
 *     `report` takes:
 *       - `update({ key, text, speaker?, speakerLabel?, start })`, a line in progress
 *       - `add({ key, text, speaker?, speakerLabel?, confidence?, language?, start, end })`, a finished line
 *       - `dropped(error?)`, the connection dropped
 *     `start` and `end` are seconds from when the connection opened, as
 *     services give them.
 *   - The handle has `finish()`, which sends the end of the audio and
 *     resolves once the last text is in, and may have `renew(connection)` for
 *     a service that takes a fresh credential during a connection.
 */

import { followEvents } from './follow.js';

// The session's events that mean no audio may go out, whoever caused them.
const STOPPED = new Set(['paused', 'closed', 'failed']);

/** An action the session refused, or a call that failed. */
export class SessionError extends Error {
  constructor(action, status, body) {
    super(`${action}: ${status}${body?.message ? ` ${body.message}` : ''}`);
    this.name = 'SessionError';
    this.action = action;
    this.status = status;
    this.body = body;
  }
}

/** The SDK function for an action: `get-connection` → `getConnectionTranscriptionSession`. */
const operationFor = (action) => `${action.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}TranscriptionSession`;

/**
 * @param {object} options
 * @param {object} options.sessions - the transcription sessions SDK, generated from the contracts
 * @param {object} options.events - the platform events SDK, generated from the contracts
 * @param {Function} [options.fetch] - the fetch the events SDK's client is
 *   configured with: the driver watches the event stream's answers through it
 * @param {object} options.adapters - client adapters by the service they speak
 *   (a transcription-services entry, such as `aws-transcribe`), or by the
 *   subprotocol, for a relay (`RELAY_PROTOCOL`), which is chosen first;
 *   `default` answers for any other.
 * @param {object} [options.transcripts] - the transcripts SDK, generated from
 *   the contracts: needed to carry on a transcript, to read where it left off
 * @param {string[]} [options.protocols] - what it can connect over.
 * @param {Function} [options.speakerFor] - a Speaker for a service's label, when the adapter gives none.
 * @param {number} [options.retries] - reconnects to try before giving up.
 * @param {Function} [options.retryDelay] - milliseconds to wait before reconnect n (from 0).
 * @param {Function} [options.now] - the client's clock.
 * @param {Function} [options.sleep] - waits a number of milliseconds.
 * @param {Function} [options.onError] - told of a report the session refused.
 */
export function createTranscriptionClient({
  sessions,
  events,
  transcripts,
  fetch,
  adapters,
  protocols = ['websocket'],
  speakerFor = () => 'unknown',
  retries = 3,
  retryDelay = (n) => 1000 * 2 ** n,
  now = () => new Date(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onError = (error) => console.error(error),
}) {
  if (!sessions || !events) throw new Error('createTranscriptionClient: give the sessions and events SDKs generated from your contracts');
  if (!adapters || !Object.keys(adapters).length) throw new Error('createTranscriptionClient: give at least one client adapter');

  /** Call an SDK function, giving its data or throwing what the session answered. */
  async function call(operation, options, label = operation, sdk = sessions) {
    const { data, error, response } = await sdk[operation](options);
    if (!response?.ok) throw new SessionError(label, response?.status, error);
    return data;
  }
  const act = (id, action, body) => call(operationFor(action), {
    path: { transcriptionSessionId: id },
    ...(body !== undefined && { body }),
  }, action);
  const get = (id) => call('getTranscriptionSession', { path: { transcriptionSessionId: id } });
  const getTranscript = (id) => call('getTranscript', { path: { transcriptId: id } }, 'getTranscript', transcripts);

  // The session can pause or close without the software asking — when its
  // transcript does — so the software follows its events, and stops sending
  // audio then (the session's state machine says so).
  const follow = (session, onEvent) => followEvents({
    events,
    fetch,
    filters: { subject: session.id, type: 'communication.transcription_session.*' },
    onEvent,
  });

  const options = { adapters, protocols, speakerFor, retries, retryDelay, now, sleep, onError, act, get, getTranscript, follow };

  return {
    /**
     * Start a session: `{ transcriptId }` to carry on under a transcript, or
     * what to start one with — `profileId`, `client`, `startedAt`, and
     * `model` unless the profile's service is `none`.
     */
    async start(fields) {
      if (fields.transcriptId && !transcripts) throw new Error('createTranscriptionClient: give the transcripts SDK to carry on a transcript');
      const record = await call('createTranscriptionSession', { body: fields });
      const session = new Session(record, options);
      session.follow();
      return session;
    },
  };
}

class Session {
  #o;
  #handle = null;
  #openedAt = null;
  // Each connection is numbered: a service's result ids are unique only
  // within a connection, so a line's key carries its connection's number.
  #connections = 0;
  #renewTimer = null;
  #ending = false;
  #capture = null;
  #following = null;
  // What the adapter reports, told to the session one at a time and in order,
  // once it knows the connection is open: text can arrive before it does.
  #queue = Promise.resolve();

  constructor(record, options) {
    this.record = record;
    this.#o = options;
  }

  get id() { return this.record.id; }

  /**
   * Follow the session's events. One that means no audio may go out —
   * paused, closed, failed — closes the connection, whoever caused it. Called
   * by `start`.
   */
  follow() {
    this.#following ??= this.#o.follow(this, (event) => this.#heard(event));
  }

  async #heard(event) {
    const what = event.type.slice(event.type.lastIndexOf('.') + 1);
    if (!STOPPED.has(what)) return;
    if (what !== 'paused') { this.#following?.stop(); this.#following = null; }
    try {
      await this.#stopAudio();
    } catch (error) { this.#o.onError(error); }
  }

  // No audio goes out: the connection closes, and the record is read again.
  async #stopAudio() {
    if (this.#handle) await this.#close();
    this.record = await this.#o.get(this.id);
  }
  get status() { return this.record.status; }

  async #act(action, body) {
    const answer = await this.#o.act(this.id, action, body);
    if (answer?.status) this.record = answer;
    else this.record = await this.#o.get(this.id);
    return answer;
  }

  #at() { return this.#o.now().toISOString(); }
  #offset(seconds) { return new Date(this.#openedAt.getTime() + seconds * 1000).toISOString(); }

  /**
   * Start streaming a capture: `{ chunks, audio }`, as captureAudio gives,
   * the audio's pieces and its AudioFormat. The session asks how to stream,
   * then opens the connection. Carrying on a transcript still recording, the
   * stretch since it was last written to is recorded as a gap.
   */
  async connect(capture) {
    this.#use(capture);
    await this.#establish(await this.#carriedOnSince());
  }

  #use(capture) {
    if (!capture?.audio) throw new Error('connect and resume take a capture: { chunks, audio }, the audio and its format');
    this.#capture = capture;
  }

  // A session carrying on a transcript that's still recording missed what
  // was said since the transcript's last line or gap (the connect request's
  // gap, in the contract), or since it started if it has none.
  async #carriedOnSince() {
    if (this.#connections > 0 || !this.record.transcriptId) return null;
    const transcript = await this.#o.getTranscript(this.record.transcriptId);
    if (transcript.status !== 'recording') return null;
    return new Date(transcript.lastActivityAt ?? transcript.startedAt);
  }

  /** Off the record: the session records the pause, then the connection is closed. */
  async pause() {
    await this.#act('pause', { at: this.#at() });
    await this.#close();
  }

  /**
   * Back on the record, on a new connection. A session carrying on a paused
   * transcript hasn't been given a capture yet, so takes one here.
   */
  async resume(capture = this.#capture) {
    this.#use(capture);
    await this.#act('resume', { at: this.#at() });
    await this.#establish();
  }

  /** Finish: the last audio is sent, the last text comes in, and the transcript closes. */
  async stop() {
    this.#ending = true;
    await this.#act('stop', { at: this.#at() });
    await this.#close();
    await this.#act('close', { at: this.#at() });
  }

  // The last text is told before this resolves.
  async #close() {
    clearTimeout(this.#renewTimer);
    const handle = this.#handle;
    this.#handle = null;
    if (handle) await handle.finish();
    await this.#queue;
  }

  // Ask how to stream, open the connection, and tell the session it's open —
  // with the stretch lost since `lostSince`, after a drop or carrying on a
  // transcript. Tries again as a reconnect does, and gives up with fail.
  async #establish(lostSince = null) {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.#open(lostSince);
        return;
      } catch (error) {
        if (this.#ending) return;
        if (error instanceof SessionError && error.action !== 'get-connection') throw error;
        if (attempt >= this.#o.retries) {
          if (['connecting', 'disconnected'].includes(this.status)) await this.#act('fail');
          throw error;
        }
        await this.#o.sleep(this.#o.retryDelay(attempt));
      }
    }
  }

  async #open(lostSince) {
    const { protocols, adapters } = this.#o;
    const { audio, chunks } = this.#capture;
    const connection = await this.#act('get-connection', { audio, protocols });
    // A relay speaks the same subprotocol whatever service is behind it, so
    // it's chosen by that before the service.
    const adapter = (connection.subprotocol && adapters[connection.subprotocol]) ?? adapters[connection.provider] ?? adapters.default;
    if (!adapter) throw new Error(`No client adapter for ${connection.provider}`);
    let opened;
    const open = new Promise((resolve) => { opened = resolve; });
    this.#queue = this.#queue.then(() => open);
    this.#openedAt = this.#o.now();
    let handle;
    try {
      handle = await adapter.open({ connection, chunks, audio, report: this.#report(++this.#connections) });
      this.#handle = handle;
      await this.#act('connect', lostSince
        ? { gap: { startedAt: lostSince.toISOString(), endedAt: this.#o.now().toISOString() } }
        : {});
    } finally { opened(); }
    this.#scheduleRenewal(connection);
  }

  // A service that takes a fresh credential during a connection gets one
  // before the last one runs out.
  #scheduleRenewal(connection) {
    if (!this.#handle?.renew) return;
    const handle = this.#handle;
    this.#renewTimer = setTimeout(async () => {
      try {
        const fresh = await this.#act('renew-connection', { audio: this.#capture.audio, protocols: this.#o.protocols });
        if (this.#handle === handle) {
          await handle.renew(fresh);
          this.#scheduleRenewal(fresh);
        }
      } catch (error) { this.#o.onError(error); }
    }, connection.expiresIn * 800);
  }

  #report(connectionNumber) {
    const key = (line) => `${connectionNumber}.${line.key}`;
    const speaker = (line) => line.speaker ?? this.#o.speakerFor(line.speakerLabel);
    // A line the session refuses may mean it stopped without the software
    // hearing yet: it's read again, and the audio stopped if so.
    const tell = (action, body) => {
      this.#queue = this.#queue.then(() => this.#act(action, body)).catch((error) => {
        this.#o.onError(error);
        this.#checkStopped();
      });
    };
    return {
      update: (line) => tell('update-line', {
        key: key(line), text: line.text, speaker: speaker(line), startedAt: this.#offset(line.start),
      }),
      add: (line) => tell('add-line', {
        key: key(line),
        text: line.text,
        speaker: speaker(line),
        startedAt: this.#offset(line.start),
        endedAt: this.#offset(line.end),
        ...(line.speakerLabel !== undefined && { speakerLabel: line.speakerLabel }),
        ...(line.confidence !== undefined && { confidence: line.confidence }),
        ...(line.language !== undefined && { language: line.language }),
      }),
      dropped: () => { this.#queue = this.#queue.then(() => this.#dropped()); },
    };
  }

  async #checkStopped() {
    try {
      const record = await this.#o.get(this.id);
      if (STOPPED.has(record.status) && this.#handle) await this.#stopAudio();
    } catch { /* told already */ }
  }

  async #dropped() {
    if (this.status !== 'connected' || this.#ending) return;
    clearTimeout(this.#renewTimer);
    this.#handle = null;
    const lostSince = this.#o.now();
    try {
      await this.#act('disconnect');
      await this.#establish(lostSince);
    } catch (error) { this.#o.onError(error); }
  }
}
