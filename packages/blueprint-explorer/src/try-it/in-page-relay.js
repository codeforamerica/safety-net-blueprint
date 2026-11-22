/**
 * A transcription relay running in the page: an implementation of the relay
 * contract (communication-transcripts-relay-asyncapi.yaml) that the mock can
 * send the relay's connections to, in place of a real relay, when it's chosen
 * in the control panel (implementations.js). Where a state's relay has Google
 * or another service behind it, this one has Whisper, in the page (whisper.js).
 *
 * It has the WebSocket constructor's signature, as a routing handler for an
 * API reached over its own connection does (blueprint-mock-server's ws.js), so
 * the mock checks every message it sends against the contract, as it would a
 * real relay's.
 *
 * What it does with the conversation, as the contract describes it:
 * - `start`: loads the transcriber, the first time, then answers `started`.
 *   It hears `linear16` English; another encoding is answered `bad-message`,
 *   another language `language-not-supported`, and a transcriber that can't
 *   load, `network`, each followed by a close.
 * - audio: heard in the format `start` gave. While someone talks, a result
 *   with `isFinal: false` about every 1.5 seconds, unless `start` turned
 *   interim results off; at a pause of 0.7 seconds, or 25 seconds into one
 *   stretch of speech, the final result for it. Whisper reads a stretch at a
 *   time rather than a stream, so the interim results come in steps.
 * - `finalize`: the final result for what's been said so far.
 * - `end`: the last final result, then `ended`, then a close.
 * - `keepalive`: nothing.
 *
 * Times are milliseconds of audio received, from the first frame.
 */

import { loadWhisper, WHISPER_RATE } from './whisper.js';

/** An event with fields, as a WebSocket's are. */
const event = (type, fields = {}) => Object.assign(new Event(type), fields);

// Below this level (root mean square, full scale 1), a frame is silence.
const SILENCE = 0.01;
const PAUSE_MS = 700;
const INTERIM_EVERY_MS = 1500;
const LONGEST_MS = 25000;

/** Mono samples at Whisper's rate from interleaved 16-bit little-endian PCM. */
export function heard(data, { sampleRateHertz, channelCount = 1 }) {
  const bytes = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const pcm = new Int16Array(bytes, 0, Math.floor(bytes.byteLength / 2));
  const frames = Math.floor(pcm.length / channelCount);
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (let c = 0; c < channelCount; c += 1) sum += pcm[i * channelCount + c];
    mono[i] = sum / channelCount / 32768;
  }
  if (sampleRateHertz === WHISPER_RATE) return mono;
  // Linear interpolation: plenty for speech recognition.
  const out = new Float32Array(Math.floor(frames * WHISPER_RATE / sampleRateHertz));
  const step = sampleRateHertz / WHISPER_RATE;
  for (let i = 0; i < out.length; i += 1) {
    const at = i * step;
    const before = Math.floor(at);
    const after = Math.min(before + 1, frames - 1);
    out[i] = mono[before] + (mono[after] - mono[before]) * (at - before);
  }
  return out;
}

/** Whether samples are silence. */
const silent = (samples) => {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / Math.max(1, samples.length)) < SILENCE;
};

const msOf = (samples) => Math.round((samples / WHISPER_RATE) * 1000);

/** Text Whisper writes for no speech, such as [BLANK_AUDIO] or (music). */
const NOTHING_SAID = /^\s*[[(][^\])]*[\])]\s*$/;

export class InPageRelay extends EventTarget {
  /** What turns speech into text: loadWhisper, unless a test gives another. */
  static transcriber = loadWhisper;

  #format = null;
  #interim = true;
  #ready = null;
  // The stretch of speech being heard: its samples, where it began, and its result's id.
  #chunks = [];
  #length = 0;
  #startedAt = 0;
  #received = 0;
  #spoke = false;
  #quietMs = 0;
  #lastInterim = 0;
  #count = 1;
  // One transcription at a time, in order.
  #work = Promise.resolve();
  #busy = false;

  /**
   * @param {string} url - Where the client connected
   * @param {string|string[]} [protocols] - What it offered; the relay speaks the first, as a real one answers with the subprotocol's name only
   */
  constructor(url, protocols = []) {
    super();
    this.url = url;
    this.protocol = [].concat(protocols)[0] ?? '';
    this.binaryType = 'arraybuffer';
    this.readyState = 0;
    queueMicrotask(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.dispatchEvent(event('open'));
    });
  }

  /** A message from the client: JSON for the relay's own messages, binary for audio. */
  send(data) {
    if (this.readyState !== 1) return;
    if (typeof data !== 'string') {
      this.#hear(data);
      return;
    }
    const message = JSON.parse(data);
    if (message.type === 'start') this.#start(message);
    if (message.type === 'finalize') this.#finish();
    if (message.type === 'end') {
      this.#finish();
      this.#then(() => {
        this.#reply({ type: 'ended' });
        this.close(1000, '');
      });
    }
  }

  close(code = 1000, reason = '') {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    queueMicrotask(() => this.dispatchEvent(event('close', { code, reason, wasClean: true })));
  }

  #start({ audio, languages, interimResults }) {
    if (audio?.encoding !== 'linear16') {
      this.#refuse('bad-message', `The relay in this page hears linear16 audio only, not ${audio?.encoding}.`);
      return;
    }
    if (languages?.length && !languages.some((language) => /^en\b/i.test(language))) {
      this.#refuse('language-not-supported', `The relay in this page hears English only, not ${languages.join(', ')}.`);
      return;
    }
    this.#format = audio;
    this.#interim = interimResults !== false;
    this.#ready = InPageRelay.transcriber();
    this.#then(() => this.#reply({ type: 'started' }));
    this.#ready.catch((error) => this.#refuse('network', `The relay in this page couldn't load its speech model: ${error.message}`));
  }

  #hear(data) {
    if (!this.#format) return;
    const samples = heard(data, this.#format);
    const frameMs = msOf(samples.length);
    if (!this.#length) this.#startedAt = this.#received;
    this.#chunks.push(samples);
    this.#length += samples.length;
    this.#received += frameMs;
    if (silent(samples)) this.#quietMs += frameMs;
    else {
      this.#quietMs = 0;
      this.#spoke = true;
    }
    if (!this.#spoke) {
      // Silence before anyone speaks isn't kept: it would only be heard as nothing.
      this.#chunks = [];
      this.#length = 0;
      return;
    }
    const heardMs = msOf(this.#length);
    if (this.#quietMs >= PAUSE_MS || heardMs >= LONGEST_MS) this.#finish();
    else if (this.#interim && !this.#busy && heardMs - this.#lastInterim >= INTERIM_EVERY_MS) {
      this.#lastInterim = heardMs;
      this.#transcribe(this.#stretch(), false);
    }
  }

  /** The stretch heard so far, as one run of samples. */
  #stretch() {
    const samples = new Float32Array(this.#length);
    let at = 0;
    for (const chunk of this.#chunks) {
      samples.set(chunk, at);
      at += chunk.length;
    }
    return { samples, id: `r${this.#count}`, startedAt: this.#startedAt };
  }

  /** The final result for the stretch heard so far, and a new stretch. */
  #finish() {
    if (this.#spoke && this.#length) this.#transcribe(this.#stretch(), true);
    this.#chunks = [];
    this.#length = 0;
    this.#spoke = false;
    this.#quietMs = 0;
    this.#lastInterim = 0;
    this.#count += 1;
  }

  #transcribe({ samples, id, startedAt }, isFinal) {
    if (!isFinal) this.#busy = true;
    this.#then(async (transcribe) => {
      try {
        const { text, words } = await transcribe(samples);
        if (!text || NOTHING_SAID.test(text)) return;
        const endOffsetMs = startedAt + msOf(samples.length);
        const alternative = { transcript: text };
        if (isFinal && words.length) {
          // Within the stretch: Whisper's last word can run past the audio.
          const within = (ms) => Math.min(startedAt + ms, endOffsetMs);
          alternative.words = words.map((w) => ({ word: w.word, startOffsetMs: within(w.startMs), endOffsetMs: Math.max(within(w.startMs), within(w.endMs)) }));
        }
        this.#reply({ type: 'result', id, isFinal, startOffsetMs: startedAt, endOffsetMs, alternatives: [alternative] });
      } finally {
        if (!isFinal) this.#busy = false;
      }
    });
  }

  /** Run after the transcriber is ready and what came before is done. */
  #then(step) {
    this.#work = this.#work
      .then(() => this.#ready)
      .then((transcribe) => (this.readyState === 1 ? step(transcribe) : undefined))
      .catch(() => { /* a refused start has said so already */ });
  }

  /** An error, then a close: 1011 for the relay's own failure, 1008 for what it was asked. */
  #refuse(code, message) {
    this.#reply({ type: 'error', code, message });
    queueMicrotask(() => this.close(code === 'network' ? 1011 : 1008, code));
  }

  /** Sent after what the client sent is handled, and before a close that follows it. */
  #reply(message) {
    if (this.readyState !== 1) return;
    queueMicrotask(() => this.dispatchEvent(event('message', { data: JSON.stringify(message) })));
  }
}
