/**
 * The session adapter's streaming part, in the explorer: the code that reaches a
 * transcription service for a transcription session
 * (communication-transcription-sessions-adapter-openapi.yaml). The session
 * calls it to start, pause and stop streaming, through routing, which sends
 * those operations to the handlers here; it reports what happens by
 * publishing the session's events with publishEvent, which the session and
 * the transcript follow.
 *
 * The handlers do the bookkeeping every adapter shares: answering at once,
 * the envelope of each event, pausing and stopping, and `ended`. What reaches
 * a service is an adapter for it, which a site adds on
 * BlueprintExplorer.sessionAdapters in its script:
 *
 *   {
 *     service: 'aws-transcribe',     // the transcription-services registry entry it reaches
 *     name: 'Amazon Transcribe',     // for people
 *     async start({ stream, audio, publish, requestCredentials, speakers }) {
 *       // stream:   what startStream was given: transcriptionSessionId,
 *       //           transcriptId, provider, model, languages, lastActivityAt
 *       // audio:    frames({ encoding, sampleRateHertz, channelCount }), an
 *       //           async iterable of frames in that format at the pace it
 *       //           was spoken; or stream(), a MediaStream
 *       // publish(event, data): one of the session's events, such as
 *       //           'connected', 'line_updated', 'line_finished',
 *       //           'disconnected' or 'failed'; transcriptId is added
 *       // requestCredentials({ audio, protocols }): the credentials part's answer
 *       // speakers: the values a line's speaker may take
 *       return { async stop() {} };   // stop resolves once the last line is published
 *     },
 *   }
 *
 * The explorer has one, for `whisper` (whisper-adapter.js). Which runs follows
 * the session's profile: the adapter for its service, the site's before the
 * explorer's. A contract set offers Whisper with a profile that names it in
 * its config.
 */

import { decodeRecording, streamRecording, mixTo, toLinear16, FRAME_MS } from './audio.js';
import { whisperAdapter } from './whisper-adapter.js';

/**
 * The adapter for a session's profile's service: the site's, else the
 * explorer's, or null when neither has one.
 *
 * @param {string} service - The session's profile's provider
 * @returns {object|null}
 */
export function adapterFor(service) {
  const adapters = [...(globalThis.BlueprintExplorer?.sessionAdapters ?? []), whisperAdapter];
  return adapters.find((adapter) => adapter.service === service) ?? null;
}

/**
 * Frames given as they come, as an async iterable: `push` one, `end` when
 * there are no more.
 */
function frameQueue() {
  const queue = [];
  let wake = null;
  let ended = false;
  return {
    push(frame) { queue.push(frame); wake?.(); },
    end() { ended = true; wake?.(); },
    async *frames() {
      while (true) {
        if (queue.length) { yield queue.shift(); continue; }
        if (ended) return;
        await new Promise((resolve) => { wake = resolve; });
        wake = null;
      }
    },
  };
}

/**
 * A recording as an adapter's audio: frames in the format it asks for, at the
 * pace it was spoken, or a MediaStream playing it. Either way it plays aloud
 * as it's given, so the reader hears what the adapter hears. `ended` settles
 * once it's all been given.
 *
 * @param {File|Blob} file
 */
export function recordingSource(file) {
  let markEnded;
  const ended = new Promise((resolve) => { markEnded = resolve; });
  let streaming = null;
  let speakers = null;
  /** The recording through the speakers, from now; and to `also`, given one. */
  const playAloud = async (also) => {
    speakers = new AudioContext();
    const source = speakers.createBufferSource();
    source.buffer = await speakers.decodeAudioData(await file.arrayBuffer());
    source.connect(speakers.destination);
    if (also) source.connect(also(speakers));
    source.onended = () => markEnded();
    source.start();
  };
  const quiet = () => { speakers?.close().catch(() => {}); speakers = null; };
  return {
    ended,
    async *frames(format) {
      const recording = await decodeRecording(await file.arrayBuffer(), format);
      const given = frameQueue();
      await playAloud();
      streaming = streamRecording(recording, format.sampleRateHertz, (frame) => { given.push(frame); return true; });
      streaming.done.then(() => given.end());
      try {
        yield* given.frames();
      } finally {
        streaming.stop();
        quiet();
        markEnded();
      }
    },
    async stream() {
      let destination;
      await playAloud((context) => (destination = context.createMediaStreamDestination()));
      return destination.stream;
    },
    /** Stop giving audio early. */
    stop() { streaming?.stop(); quiet(); markEnded(); },
  };
}

/**
 * The microphone as an adapter's audio: what it hears, in frames in the
 * format it asks for as it's said, or its MediaStream. The browser asks the
 * reader first. It runs until `stop`, which settles `ended`.
 */
export function microphoneSource() {
  let markEnded;
  const ended = new Promise((resolve) => { markEnded = resolve; });
  let microphone = null;
  let context = null;
  let given = null;
  const open = () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const stop = () => {
    microphone?.getTracks().forEach((track) => track.stop());
    context?.close().catch(() => {});
    given?.end();
    markEnded();
  };
  return {
    ended,
    async *frames(format) {
      microphone = await open();
      // The context resamples what the microphone hears to the rate asked for.
      context = new AudioContext({ sampleRate: format.sampleRateHertz });
      const perFrame = Math.round(format.sampleRateHertz * FRAME_MS / 1000);
      // A data: URL, since a page opened from disk can't load a worklet from a blob: one.
      await context.audioWorklet.addModule(`data:text/javascript,${encodeURIComponent(HEARING)}`);
      const hearing = new AudioWorkletNode(context, 'hearing');
      given = frameQueue();
      let held = [];
      let length = 0;
      hearing.port.onmessage = ({ data }) => {
        held.push(data);
        length += data.length;
        if (length < perFrame) return;
        const samples = new Float32Array(length);
        let at = 0;
        for (const chunk of held) { samples.set(chunk, at); at += chunk.length; }
        held = [];
        length = 0;
        const channels = mixTo([samples], format.channelCount);
        given.push(toLinear16(channels, 0, samples.length));
      };
      context.createMediaStreamSource(microphone).connect(hearing);
      try {
        yield* given.frames();
      } finally {
        stop();
      }
    },
    async stream() {
      microphone = await open();
      return microphone;
    },
    /** Stop listening. */
    stop,
  };
}

// An audio worklet that passes on what it hears, a block of samples at a time.
const HEARING = `registerProcessor('hearing', class extends AudioWorkletProcessor {
  process([input]) {
    if (input?.[0]?.length) this.port.postMessage(input[0].slice());
    return true;
  }
});`;

/** No audio: nothing is heard until it's stopped. */
function silence() {
  const given = frameQueue();
  let markEnded;
  const ended = new Promise((resolve) => { markEnded = resolve; });
  return {
    ended,
    frames: () => given.frames(),
    async stream() { return new MediaStream(); },
    stop() { given.end(); markEnded(); },
  };
}

// ── The handlers routing sends the adapter's streaming part to ───────────────────

/** How the handlers reach the contracts: set once the page's mock starts. */
let host = null;

/**
 * Give the handlers a way to call operations — through the page's mock, or
 * where routing sends them — and the contracts, for paths and event types.
 *
 * @param {object} given
 * @param {(method: string, path: string, body?: object) => Promise<{ status: number, body: any }>} given.call
 * @param {object[]} given.docs
 */
export function hostSessionAdapters({ call, docs }) {
  host = { call, docs };
}

/** The audio chosen for a session's next start, by its id. */
const chosen = new Map();

/**
 * The audio a session's adapter hears when it next starts or resumes: a
 * recording, the microphone, or typed lines spoken. With none, it hears
 * nothing.
 *
 * @param {string} sessionId
 * @param {object} audio - recordingSource's or microphoneSource's
 */
export function audioForSession(sessionId, audio) {
  chosen.set(sessionId, audio);
}

/** Each session's running adapter, by the session's id. */
const running = new Map();

/** Each session's transcript, by the session's id, for `ended` after a pause. */
const transcripts = new Map();

/** The served path of an operation, by its operationId. */
const pathOf = (operationId) => {
  for (const doc of host?.docs ?? []) {
    if (doc.type !== 'openapi') continue;
    const local = (Array.isArray(doc.content?.servers) ? doc.content.servers : []).find((server) => /localhost|127\.0\.0\.1/.test(server?.url ?? ''));
    let base = '';
    try { base = local ? new URL(local.url).pathname.replace(/\/$/, '') : ''; } catch { /* none */ }
    for (const [path, item] of Object.entries(doc.content?.paths ?? {})) {
      if (Object.values(item ?? {}).some((operation) => operation?.operationId === operationId)) return base + path;
    }
  }
  return null;
};

/** A session event's type, as the contracts name it: the channel ending in it. */
const eventTypeOf = (event) => {
  const suffix = `transcription_session.${event}`;
  for (const doc of host?.docs ?? []) {
    for (const channel of Object.values(doc.content?.channels ?? {})) {
      if (String(channel?.address ?? '').endsWith(suffix)) return channel.address;
    }
  }
  return `communication.${suffix}`;
};

/** The values a line's speaker may take, from the transcript's Speaker. */
const speakersOf = () => {
  for (const doc of host?.docs ?? []) {
    const values = doc.content?.components?.schemas?.Speaker?.enum;
    if (Array.isArray(values)) return values;
  }
  return ['unknown'];
};

/** Publish one of a session's events, as its adapter does. */
const publisher = (stream) => async (event, data = {}) => {
  const { status, body } = await host.call('POST', pathOf('publishEvent') ?? '/platform/events', {
    specversion: '1.0',
    id: crypto.randomUUID(),
    source: '/communication',
    type: eventTypeOf(event),
    subject: stream.transcriptionSessionId,
    partitionkey: stream.transcriptionSessionId,
    time: new Date().toISOString(),
    datacontenttype: 'application/json',
    data: { transcriptId: stream.transcriptId, ...data },
  });
  if (status >= 400) throw new Error(`publishing ${event} answered ${status}: ${body?.message ?? ''}`.trim());
};

const accepted = (body) => Response.json({ metadata: body?.metadata ?? {} }, { status: 202 });

async function begin(stream) {
  transcripts.set(stream.transcriptionSessionId, stream.transcriptId);
  const publish = publisher(stream);
  const audio = chosen.get(stream.transcriptionSessionId) ?? silence();
  chosen.delete(stream.transcriptionSessionId);
  const adapter = adapterFor(stream.provider);
  if (!adapter) {
    await publish('failed', { reason: `No session adapter for ${stream.provider}: a site adds one on BlueprintExplorer.sessionAdapters.` });
    return;
  }
  const requestCredentials = async ({ audio: format, protocols }) => {
    const { status, body } = await host.call('POST', pathOf('requestCredentials') ?? '/credentials', {
      metadata: { transcriptionSessionId: stream.transcriptionSessionId, transcriptId: stream.transcriptId },
      provider: stream.provider,
      ...(stream.model ? { model: stream.model } : {}),
      ...(stream.languages ? { languages: stream.languages } : {}),
      audio: format,
      protocols,
    });
    if (status >= 400) throw new Error(`requestCredentials answered ${status}: ${body?.message ?? ''}`.trim());
    return body;
  };
  try {
    const handle = await adapter.start({ stream, audio, publish, requestCredentials, speakers: speakersOf() });
    running.set(stream.transcriptionSessionId, { handle, audio });
  } catch (error) {
    audio.stop();
    await publish('failed', { reason: error.message }).catch(() => {});
  }
}

/** Stop a session's adapter, if it's running, and its audio. */
async function halt(sessionId) {
  const run = running.get(sessionId);
  running.delete(sessionId);
  if (!run) return;
  run.audio.stop();
  await run.handle.stop();
}

/**
 * Handlers for the adapter's streaming part, by operationId: startStream,
 * pauseStream and stopStream. Each answers at once, as the contract says,
 * and does its work after.
 */
export const streamHandlers = {
  async startStream(request) {
    const body = await request.json();
    setTimeout(() => { begin(body).catch((error) => console.warn(`The session adapter: ${error.message}`)); }, 0);
    return accepted(body);
  },
  async pauseStream(request) {
    const sessionId = new URL(request.url).pathname.split('/').at(-2);
    const body = await request.json().catch(() => ({}));
    setTimeout(() => { halt(sessionId).catch((error) => console.warn(`The session adapter: ${error.message}`)); }, 0);
    return accepted(body);
  },
  async stopStream(request) {
    const sessionId = new URL(request.url).pathname.split('/').at(-2);
    const body = await request.json().catch(() => ({}));
    setTimeout(async () => {
      try {
        await halt(sessionId);
        // After a reload, the session says which transcript it has.
        let transcriptId = transcripts.get(sessionId);
        if (!transcriptId) {
          const path = (pathOf('getTranscriptionSession') ?? '').replace(/\{[^}]+\}/, encodeURIComponent(sessionId));
          transcriptId = (await host.call('GET', path)).body?.transcriptId;
        }
        await publisher({ transcriptionSessionId: sessionId, transcriptId })('ended', { at: new Date().toISOString() });
      } catch (error) {
        console.warn(`The session adapter: ${error.message}`);
      }
    }, 0);
    return accepted(body);
  },
};
