/**
 * Whisper in this page: a transcription session adapter for a profile whose
 * provider is `whisper` (communication-transcription-sessions-adapter-openapi.yaml).
 * It transcribes in the browser, with Whisper (whisper-model.js), so a
 * session can be tried with no transcription service and no account. The
 * harness site routes the session adapter to it (../routing.yaml):
 *
 *   routing:
 *     - api: communication-transcription-sessions-adapter
 *       match: { provider: whisper }
 *       handler: ./adapters/whisper.js
 *
 * It's the whole adapter, written as any adapter is, to copy for another
 * service. The session calls startStream, pauseStream and stopStream; each
 * answers 202 at once, and the work goes on after. Whisper runs here and
 * takes no credential, so the adapter has no credentials part and asks for
 * none: it hears the microphone, and reports only by publishing the
 * session's events (communication-transcription-sessions-adapter-asyncapi.yaml):
 * connected, line_updated, line_finished, failed, and after a stop, ended.
 * Pausing stops it; the session starts it again to resume.
 *
 * Each handler gets the request and `{ params, publish, call }` from routing:
 * `publish` sends one of the session's events, `call` calls another operation
 * by its operationId, wherever routing sends it.
 *
 * It hears 16 kHz mono, in stretches of speech: while someone talks, a line
 * in progress about every 1.5 seconds; at a pause of 0.7 seconds, or 25
 * seconds into one stretch, the finished line. Whisper reads a stretch at a
 * time rather than a stream, so lines in progress come in steps.
 */

import { loadWhisper, WHISPER_RATE } from './whisper-model.js';

// Below this level (root mean square, full scale 1), a stretch of samples is silence.
const SILENCE = 0.01;
const PAUSE_MS = 700;
const IN_PROGRESS_EVERY_MS = 1500;
const LONGEST_MS = 25000;
/** Text Whisper writes for no speech, such as [BLANK_AUDIO] or (music). */
const NOTHING_SAID = /^\s*[[(][^\])]*[\])]\s*$/;

const msOf = (samples) => Math.round((samples / WHISPER_RATE) * 1000);

const silent = (samples) => {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / Math.max(1, samples.length)) < SILENCE;
};

// An audio worklet that passes on what it hears, a block of samples at a time.
const HEARING = `registerProcessor('hearing', class extends AudioWorkletProcessor {
  process([input]) {
    if (input?.[0]?.length) this.port.postMessage(input[0].slice());
    return true;
  }
});`;

/**
 * The microphone, at Whisper's rate, mono: `hear` gets each block of samples
 * as it's heard. The browser asks the person first.
 *
 * @returns {Promise<() => Promise<void>>} Stop listening
 */
async function listen(hear) {
  const microphone = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  // The context resamples what the microphone hears to the rate asked for.
  const context = new AudioContext({ sampleRate: WHISPER_RATE });
  // A data: URL, since a page opened from disk can't load a worklet from a blob: one.
  await context.audioWorklet.addModule(`data:text/javascript,${encodeURIComponent(HEARING)}`);
  const hearing = new AudioWorkletNode(context, 'hearing');
  hearing.port.onmessage = ({ data }) => hear(data);
  context.createMediaStreamSource(microphone).connect(hearing);
  return () => {
    microphone.getTracks().forEach((track) => track.stop());
    return context.close().catch(() => {});
  };
}

/**
 * Transcribe one session until stopped, publishing its lines.
 *
 * @returns {Promise<() => Promise<void>>} Stop: resolves once the last line is published
 */
async function transcribe(stream, publish) {
  const transcribeStretch = await loadWhisper();
  // One speaker, Speaker's `unknown`: Whisper doesn't tell voices apart.
  const speaker = 'unknown';
  const began = Date.now();
  const at = (ms) => new Date(began + ms).toISOString();
  // Keys stay unique when the session resumes and starts the adapter again.
  const run = began.toString(36);

  let chunks = [];
  let length = 0;
  let startedAt = 0;
  let received = 0;
  let spoke = false;
  let quietMs = 0;
  let lastInProgress = 0;
  let count = 1;
  let busy = false;
  // One transcription at a time, in order.
  let work = Promise.resolve();

  const stretch = () => {
    const samples = new Float32Array(length);
    let offset = 0;
    for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
    return { samples, key: `${run}.l${count}`, from: startedAt };
  };

  const send = ({ samples, key, from }, finished) => {
    if (!finished) busy = true;
    work = work.then(async () => {
      try {
        const { text } = await transcribeStretch(samples);
        if (!text || NOTHING_SAID.test(text)) return;
        if (finished) await publish('line_finished', { key, text, speaker, startedAt: at(from), endedAt: at(from + msOf(samples.length)) });
        else await publish('line_updated', { key, text, speaker, startedAt: at(from) });
      } catch (error) {
        console.warn(`Whisper in this page: ${error.message}`);
      } finally {
        if (!finished) busy = false;
      }
    });
  };

  /** The finished line for the stretch heard so far, and a new stretch. */
  const finish = () => {
    if (spoke && length) send(stretch(), true);
    chunks = [];
    length = 0;
    spoke = false;
    quietMs = 0;
    lastInProgress = 0;
    count += 1;
  };

  const hear = (samples) => {
    const heardMs = msOf(samples.length);
    if (!length) startedAt = received;
    received += heardMs;
    chunks.push(samples);
    length += samples.length;
    if (silent(samples)) quietMs += heardMs;
    else { quietMs = 0; spoke = true; }
    // Silence before anyone speaks isn't kept.
    if (!spoke) { chunks = []; length = 0; return; }
    const stretchMs = msOf(length);
    if (quietMs >= PAUSE_MS || stretchMs >= LONGEST_MS) finish();
    else if (!busy && stretchMs - lastInProgress >= IN_PROGRESS_EVERY_MS) {
      lastInProgress = stretchMs;
      send(stretch(), false);
    }
  };

  const stopListening = await listen(hear);
  try {
    // Carrying on a transcript still recording: what it last heard to now is a gap.
    await publish('connected', stream.lastActivityAt
      ? { gap: { startedAt: stream.lastActivityAt, endedAt: new Date(began).toISOString() } }
      : {});
  } catch (error) {
    await stopListening();
    throw error;
  }

  return async () => {
    await stopListening();
    finish();
    await work;
  };
}

/** Each session's stop, while it's transcribing, and its transcript. */
const running = new Map();
const transcripts = new Map();

/** Publish one of a session's events, about the session, with its transcript. */
const publisher = (context, sessionId) => async (event, data = {}) => {
  const answer = await context.publish(`transcription_session.${event}`, { transcriptId: transcripts.get(sessionId), ...data }, { subject: sessionId });
  if (answer.status >= 400) throw new Error(`publishing ${event} answered ${answer.status}: ${answer.body?.message ?? ''}`.trim());
};

/** Do the work after answering, reporting what goes wrong. */
const later = (work) => setTimeout(() => { work().catch((error) => console.warn(`Whisper in this page: ${error.message}`)); }, 0);

/** Stop a session's transcribing, if it is. */
async function halt(sessionId) {
  const stop = running.get(sessionId);
  running.delete(sessionId);
  await stop?.();
}

export async function startStream(request, context) {
  const stream = await request.json();
  const sessionId = stream.transcriptionSessionId;
  transcripts.set(sessionId, stream.transcriptId);
  const publish = publisher(context, sessionId);
  later(async () => {
    try {
      running.set(sessionId, await transcribe(stream, publish));
    } catch (error) {
      await publish('failed', { reason: error.message }).catch(() => {});
    }
  });
  return Response.json({ metadata: stream.metadata ?? {} }, { status: 202 });
}

export async function pauseStream(request, context) {
  const body = await request.json().catch(() => ({}));
  later(() => halt(context.params.transcriptionSessionId));
  return Response.json({ metadata: body.metadata ?? {} }, { status: 202 });
}

export async function stopStream(request, context) {
  const sessionId = context.params.transcriptionSessionId;
  const body = await request.json().catch(() => ({}));
  later(async () => {
    await halt(sessionId);
    // After a reload, the session says which transcript it has.
    if (!transcripts.has(sessionId)) {
      const session = await context.call('getTranscriptionSession', { params: { transcriptionSessionId: sessionId } });
      transcripts.set(sessionId, session.body?.transcriptId);
    }
    await publisher(context, sessionId)('ended', { at: new Date().toISOString() });
  });
  return Response.json({ metadata: body.metadata ?? {} }, { status: 202 });
}
