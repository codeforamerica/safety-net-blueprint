/**
 * The driver: the one part of transcription software that talks to the
 * transcription session. A client adapter speaks one service's protocol and
 * reports what happens; the driver turns each report into the session's
 * action, so no adapter holds any session logic and every adapter works the
 * same way. See docs/architecture/cross-cutting/browser-vendor-stream.md.
 *
 * It calls the session's actions through the blueprint's API with the fetch
 * it's given: in a page, the in-page mock's fetch, which routing sends on to
 * wherever each operation is answered.
 *
 * A client adapter is an object with:
 *   - `open({ connection, audio, report })`: open a connection with what
 *     get-connection answered, stream `audio` (whatever the page captured,
 *     passed through untouched), and resolve with a handle once it's open.
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

const SESSIONS = 'transcription-sessions';

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

/**
 * @param {object} options
 * @param {object} options.adapters - client adapters by the service they speak
 *   (a transcription-services entry, such as `aws-transcribe`); `default`
 *   answers for any other.
 * @param {object} options.audio - the AudioFormat the software sends.
 * @param {string[]} [options.protocols] - what it can connect over.
 * @param {Function} [options.fetch] - `fetch`'s signature; the in-page mock's in a page.
 * @param {string} [options.baseUrl] - where the communication domain is served.
 * @param {object|Function} [options.headers] - sent with every call, such as
 *   who the caller is; a function is asked each time, for a token that renews.
 * @param {Function} [options.speakerFor] - a Speaker for a service's label, when the adapter gives none.
 * @param {number} [options.retries] - reconnects to try before giving up.
 * @param {Function} [options.retryDelay] - milliseconds to wait before reconnect n (from 0).
 * @param {Function} [options.now] - the client's clock.
 * @param {Function} [options.sleep] - waits a number of milliseconds.
 * @param {Function} [options.onError] - told of a report the session refused.
 */
export function createTranscriptionClient({
  adapters,
  audio,
  protocols = ['websocket'],
  fetch: send = globalThis.fetch,
  baseUrl = 'http://localhost/communication',
  headers = {},
  speakerFor = () => 'unknown',
  retries = 3,
  retryDelay = (n) => 1000 * 2 ** n,
  now = () => new Date(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onError = (error) => console.error(error),
}) {
  if (!adapters || !Object.keys(adapters).length) throw new Error('createTranscriptionClient: give at least one client adapter');
  if (!audio) throw new Error('createTranscriptionClient: say what audio the software sends');

  async function call(method, path, body, label) {
    const response = await send(new Request(`${baseUrl}/${path}`, {
      method,
      headers: { ...(typeof headers === 'function' ? await headers() : headers), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
    const text = await response.text();
    const parsed = text ? JSON.parse(text) : null;
    if (!response.ok) throw new SessionError(label, response.status, parsed);
    return parsed;
  }

  const options = { adapters, audio, protocols, speakerFor, retries, retryDelay, now, sleep, onError, call };

  return {
    /**
     * Start a session: `{ transcriptId }` to carry on under a transcript, or
     * what to start one with — `profileId`, `client`, `startedAt`, and
     * `model` unless the profile's service is `none`.
     */
    async start(fields) {
      const record = await call('POST', SESSIONS, fields, 'createTranscriptionSession');
      return new Session(record, options);
    },
  };
}

class Session {
  #o;
  #handle = null;
  #openedAt = null;
  #renewTimer = null;
  #ending = false;
  #audio = null;
  // What the adapter reports, told to the session one at a time and in order,
  // once it knows the connection is open: text can arrive before it does.
  #queue = Promise.resolve();

  constructor(record, options) {
    this.record = record;
    this.#o = options;
  }

  get id() { return this.record.id; }
  get status() { return this.record.status; }

  async #act(action, body = {}) {
    const answer = await this.#o.call('POST', `${SESSIONS}/${this.id}/${action}`, body, action);
    if (answer?.status) this.record = answer;
    else this.record = await this.#o.call('GET', `${SESSIONS}/${this.id}`, undefined, 'getTranscriptionSession');
    return answer;
  }

  #at() { return this.#o.now().toISOString(); }
  #offset(seconds) { return new Date(this.#openedAt.getTime() + seconds * 1000).toISOString(); }

  /** Start streaming `audio`. The session asks how to stream, then opens the connection. */
  async connect(audio) {
    this.#audio = audio;
    await this.#establish();
  }

  /** Off the record: the session records the pause, then the connection is closed. */
  async pause() {
    await this.#act('pause', { at: this.#at() });
    await this.#close();
  }

  /** Back on the record, on a new connection. */
  async resume() {
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
  // with the stretch lost since `lostSince`, after a drop. Tries again as a
  // reconnect does, and gives up with fail.
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
    const { audio, protocols, adapters } = this.#o;
    const connection = await this.#act('get-connection', { audio, protocols });
    const adapter = adapters[connection.provider] ?? adapters.default;
    if (!adapter) throw new Error(`No client adapter for ${connection.provider}`);
    let opened;
    const open = new Promise((resolve) => { opened = resolve; });
    this.#queue = this.#queue.then(() => open);
    this.#openedAt = this.#o.now();
    let handle;
    try {
      handle = await adapter.open({ connection, audio: this.#audio, report: this.#report() });
      this.#handle = handle;
      await this.#act('connect', lostSince
        ? { lostStretch: { startedAt: lostSince.toISOString(), endedAt: this.#o.now().toISOString() } }
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
        const fresh = await this.#act('renew-connection', { audio: this.#o.audio, protocols: this.#o.protocols });
        if (this.#handle === handle) {
          await handle.renew(fresh);
          this.#scheduleRenewal(fresh);
        }
      } catch (error) { this.#o.onError(error); }
    }, connection.expiresIn * 800);
  }

  #report() {
    const speaker = (line) => line.speaker ?? this.#o.speakerFor(line.speakerLabel);
    const tell = (action, body) => {
      this.#queue = this.#queue.then(() => this.#act(action, body)).catch(this.#o.onError);
    };
    return {
      update: (line) => tell('update-line', {
        key: line.key, text: line.text, speaker: speaker(line), startedAt: this.#offset(line.start),
      }),
      add: (line) => tell('add-line', {
        key: line.key,
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
