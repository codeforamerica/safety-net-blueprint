/**
 * Whisper in this page: an example transcription session adapter, for a
 * profile whose provider is `whisper`. It transcribes in the browser, with
 * Whisper (whisper-model.js), so a session can be tried with no transcription
 * service and no account. A site routes the session adapter to it:
 *
 *   # routing.yaml
 *   routing:
 *     - api: communication-transcription-sessions-adapter
 *       match: { provider: whisper }
 *       handler: ./whisper.js
 *
 * Copy it to write an adapter for another service: the streaming part is
 * `start`, given to sessionAdapter, which does what every adapter shares; the
 * credentials part, requestCredentials, is answered here since Whisper needs
 * none, where another service's goes to the state's server.
 *
 * It hears 16 kHz mono linear16 frames, in stretches of speech: while someone
 * talks, a line in progress about every 1.5 seconds; at a pause of 0.7
 * seconds, or 25 seconds into one stretch, the finished line. Whisper reads a
 * stretch at a time rather than a stream, so lines in progress come in steps.
 */

import { sessionAdapter } from '@codeforamerica/blueprint-explorer/session-adapter';
import { loadWhisper, WHISPER_RATE } from './whisper-model.js';

const FORMAT = { encoding: 'linear16', sampleRateHertz: WHISPER_RATE, channelCount: 1 };
// Below this level (root mean square, full scale 1), a frame is silence.
const SILENCE = 0.01;
const PAUSE_MS = 700;
const IN_PROGRESS_EVERY_MS = 1500;
const LONGEST_MS = 25000;
/** Text Whisper writes for no speech, such as [BLANK_AUDIO] or (music). */
const NOTHING_SAID = /^\s*[[(][^\])]*[\])]\s*$/;

const msOf = (samples) => Math.round((samples / WHISPER_RATE) * 1000);

/** Samples, full scale 1, from 16-bit little-endian PCM. */
const samplesOf = (frame) => {
  const pcm = new Int16Array(frame instanceof ArrayBuffer ? frame : frame.buffer);
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i += 1) out[i] = pcm[i] / 32768;
  return out;
};

const silent = (samples) => {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / Math.max(1, samples.length)) < SILENCE;
};

export const { startStream, pauseStream, stopStream } = sessionAdapter({
  async start({ stream, audio, publish, requestCredentials }) {
    await requestCredentials({ audio: FORMAT, protocols: ['websocket'] });
    const transcribe = await loadWhisper();
    // One speaker, Speaker's `unknown`: Whisper doesn't tell voices apart.
    const speaker = 'unknown';
    const began = Date.now();
    const at = (ms) => new Date(began + ms).toISOString();
    // Keys stay unique when the session resumes and starts the adapter again.
    const run = began.toString(36);
    // Carrying on a transcript still recording: what it last heard to now is a gap.
    await publish('connected', stream.lastActivityAt
      ? { gap: { startedAt: stream.lastActivityAt, endedAt: new Date(began).toISOString() } }
      : {});

    let chunks = [];
    let length = 0;
    let startedAt = 0;
    let received = 0;
    let spoke = false;
    let quietMs = 0;
    let lastInProgress = 0;
    let count = 1;
    let stopped = false;
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
          const { text } = await transcribe(samples);
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

    const hear = (frame) => {
      const samples = samplesOf(frame);
      const frameMs = msOf(samples.length);
      if (!length) startedAt = received;
      received += frameMs;
      chunks.push(samples);
      length += samples.length;
      if (silent(samples)) quietMs += frameMs;
      else { quietMs = 0; spoke = true; }
      // Silence before anyone speaks isn't kept.
      if (!spoke) { chunks = []; length = 0; return; }
      const heardMs = msOf(length);
      if (quietMs >= PAUSE_MS || heardMs >= LONGEST_MS) finish();
      else if (!busy && heardMs - lastInProgress >= IN_PROGRESS_EVERY_MS) {
        lastInProgress = heardMs;
        send(stretch(), false);
      }
    };

    const listening = (async () => {
      for await (const frame of audio.frames(FORMAT)) {
        if (stopped) break;
        hear(frame);
      }
      finish();
    })();

    // Pausing stops it too: the session starts it again to resume.
    return {
      async stop() {
        stopped = true;
        await listening;
        await work;
      },
      /** Settles once the audio has run out and its last line is in. */
      done: listening.then(() => work),
    };
  },
});

/**
 * The credentials part: Whisper needs none, so where to connect names nothing
 * real. Another service's adapter leaves this to the state's server, which
 * holds the service's secret.
 */
export async function requestCredentials(request) {
  const { metadata, provider } = await request.json();
  return Response.json({ metadata, provider, protocol: 'websocket', url: 'wss://whisper.invalid/in-this-page', expiresIn: 3600 });
}
