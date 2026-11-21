/**
 * Audio for a WebSocket API that takes it as binary frames, such as the
 * transcript relay: a recording, turned into the format the software declared
 * when it started, and sent in frames at the pace it was spoken.
 *
 * The browser decodes any recording it can play (WAV, MP3, M4A, and OGG or
 * FLAC depending on the browser), and an OfflineAudioContext at the declared
 * rate converts it to that rate as it decodes, so the recording needn't match
 * the format. Only linear16, 16-bit signed little-endian PCM, is written: a
 * browser has no way to write the others frame by frame.
 *
 * Paced as spoken because a real streaming service expects audio as it's
 * said, and some refuse it faster; the mock in the page doesn't care.
 */

/** The longest recording sent, so a decoded one stays a few megabytes. */
export const MAX_SECONDS = 600;

/** How much audio each frame carries, as streaming services suggest: 50 to 100 ms. */
export const FRAME_MS = 100;

/** The encodings this can write. */
export const WRITABLE = ['linear16'];

/**
 * A recording, decoded at a rate and mixed to a number of channels.
 *
 * @param {ArrayBuffer} bytes - The file's contents
 * @param {{ sampleRateHertz: number, channelCount: number }} format
 * @returns {Promise<{ channels: Float32Array[], seconds: number }>}
 * @throws {Error} When the browser can't decode it, or it runs over MAX_SECONDS
 */
export async function decodeRecording(bytes, { sampleRateHertz, channelCount }) {
  const context = new OfflineAudioContext(1, 1, sampleRateHertz);
  let buffer;
  try {
    buffer = await context.decodeAudioData(bytes);
  } catch {
    throw new Error('This browser can\'t decode that file as audio. Try WAV or MP3.');
  }
  if (buffer.duration > MAX_SECONDS) {
    throw new Error(`The recording is ${Math.round(buffer.duration / 60)} minutes long; send one of ${MAX_SECONDS / 60} minutes or less.`);
  }
  const sources = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  return { channels: mixTo(sources, channelCount), seconds: buffer.duration };
}

/**
 * Channels mixed to a count: down to one by averaging them, otherwise each
 * one kept, the last repeated where the recording has fewer.
 *
 * @param {Float32Array[]} sources
 * @param {number} count
 * @returns {Float32Array[]}
 */
export function mixTo(sources, count) {
  if (count === 1 && sources.length > 1) {
    const mixed = new Float32Array(sources[0].length);
    for (const source of sources) for (let i = 0; i < mixed.length; i += 1) mixed[i] += source[i] / sources.length;
    return [mixed];
  }
  return Array.from({ length: count }, (_, i) => sources[Math.min(i, sources.length - 1)]);
}

/**
 * Samples as linear16: 16-bit signed little-endian PCM, channels interleaved.
 *
 * @param {Float32Array[]} channels
 * @param {number} from - The first sample
 * @param {number} to - One past the last
 * @returns {ArrayBuffer}
 */
export function toLinear16(channels, from, to) {
  const count = to - from;
  const view = new DataView(new ArrayBuffer(count * channels.length * 2));
  for (let i = 0; i < count; i += 1) {
    for (let c = 0; c < channels.length; c += 1) {
      const sample = Math.max(-1, Math.min(1, channels[c][from + i]));
      view.setInt16((i * channels.length + c) * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
  }
  return view.buffer;
}

/**
 * Send decoded audio in frames, each when the one before it would have
 * finished playing, until it's all sent or `stop` is called.
 *
 * @param {{ channels: Float32Array[] }} recording
 * @param {number} sampleRateHertz
 * @param {(frame: ArrayBuffer) => boolean} send - Sends a frame; false once it can't
 * @param {(sentSeconds: number) => void} [progress]
 * @returns {{ done: Promise<'sent'|'stopped'>, stop: () => void }}
 */
export function streamRecording({ channels }, sampleRateHertz, send, progress = () => {}) {
  const perFrame = Math.round(sampleRateHertz * FRAME_MS / 1000);
  const total = channels[0]?.length ?? 0;
  let stopped = false;
  let timer = null;
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  const began = performance.now();
  let at = 0;
  const next = () => {
    if (stopped) return;
    const to = Math.min(at + perFrame, total);
    if (!send(toLinear16(channels, at, to))) { finish('stopped'); return; }
    at = to;
    progress(at / sampleRateHertz);
    if (at >= total) { finish('sent'); return; }
    // From when streaming began, so frames don't drift later one by one.
    timer = setTimeout(next, Math.max(0, began + (at / sampleRateHertz) * 1000 - performance.now()));
  };
  next();
  return {
    done,
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      finish('stopped');
    },
  };
}
