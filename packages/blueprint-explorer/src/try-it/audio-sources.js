/**
 * Where a transcription session's adapter's audio comes from in Try it: a
 * recording, played aloud as it's given; the microphone; or typed lines,
 * spoken first (kokoro.js). Each has frames(format), an async iterable of
 * frames in the format the adapter asks for at the pace they were spoken;
 * stream(), a MediaStream; and stop(). Send hands the chosen one to the
 * session's adapter (session-adapter.js, audioForSession).
 */

import { decodeRecording, streamRecording, mixTo, toLinear16, FRAME_MS } from './audio.js';

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
