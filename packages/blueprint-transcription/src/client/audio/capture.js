/**
 * Capturing an interview's audio in the page, in the form the session and
 * every client adapter take: 16-bit little-endian PCM (linear16), one channel
 * per source, interleaved, in chunks of a fixed length.
 *
 * Sources:
 * - the worker's microphone, channel 0;
 * - audio the worker shares from another window or tab, such as a softphone
 *   on a phone interview, channel 1, for the applicant;
 * - a stereo recording played instead, for practice and demos: left is the
 *   worker, right the applicant.
 *
 * With one source the audio is one channel and the service tells speakers
 * apart by voice. With two, each speaker has a channel, which is more
 * reliable.
 *
 * The browser does the resampling: the audio context runs at the rate asked
 * for. The conversion to 16-bit PCM runs in an AudioWorklet, off the page's
 * main thread. Based on the transcription tools' web/lib/audio-capture.js.
 */

const ENCODING = 'linear16';

/**
 * Turn float samples (-1 to 1) from any number of channels into interleaved
 * 16-bit PCM, emitting a chunk each time one fills. Self-contained: the
 * worklet gets its source as text.
 *
 * @param {number} channelCount
 * @param {number} chunkFrames - samples per channel in a chunk
 * @param {(buffer: ArrayBuffer) => void} emit
 * @returns {(channels: Float32Array[]) => void}
 */
export function createInterleaver(channelCount, chunkFrames, emit) {
  let buffer = new Int16Array(chunkFrames * channelCount);
  let filled = 0;
  return function write(channels) {
    let frames = 0;
    for (const channel of channels) if (channel && channel.length > frames) frames = channel.length;
    for (let i = 0; i < frames; i += 1) {
      for (let c = 0; c < channelCount; c += 1) {
        const sample = Math.max(-1, Math.min(1, channels[c]?.[i] ?? 0));
        buffer[filled * channelCount + c] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }
      filled += 1;
      if (filled === chunkFrames) {
        emit(buffer.buffer);
        buffer = new Int16Array(chunkFrames * channelCount);
        filled = 0;
      }
    }
  };
}

/**
 * Chunks pushed as they come, read as an async iterable, which is what
 * `session.connect` takes. Ends when `end` is called; chunks pushed with
 * nobody reading wait in order.
 */
export function createChunkQueue() {
  const waiting = [];
  const readers = [];
  let ended = false;
  return {
    push(chunk) {
      if (ended) return;
      const reader = readers.shift();
      if (reader) reader({ value: chunk, done: false });
      else waiting.push(chunk);
    },
    end() {
      ended = true;
      for (const reader of readers.splice(0)) reader({ value: undefined, done: true });
    },
    [Symbol.asyncIterator]() {
      return {
        next: () => {
          if (waiting.length) return Promise.resolve({ value: waiting.shift(), done: false });
          if (ended) return Promise.resolve({ value: undefined, done: true });
          return new Promise((resolve) => readers.push(resolve));
        },
      };
    },
  };
}

/** Runs in the audio thread; given the interleaver's source as its argument. */
function processor(createInterleaver) {
  registerProcessor('blueprint-linear16', class extends AudioWorkletProcessor {
    constructor(options) {
      super();
      const { channelCount, chunkFrames } = options.processorOptions;
      this.write = createInterleaver(channelCount, chunkFrames, (buffer) => this.port.postMessage(buffer, [buffer]));
    }

    process(inputs) {
      this.write(inputs[0] ?? []);
      return true;
    }
  });
}

/**
 * Start capturing. Asks for the microphone, and for a shared window or tab
 * when `sharedAudio` is set, so call it from a click.
 *
 * @param {object} [options]
 * @param {boolean} [options.microphone] - the worker's microphone (default true)
 * @param {boolean} [options.sharedAudio] - audio shared from another window, for the applicant
 * @param {Blob|ArrayBuffer} [options.recording] - a stereo recording to play instead of live audio
 * @param {number} [options.sampleRateHertz] - default 16000
 * @param {number} [options.chunkMs] - length of each chunk (default 100)
 * @param {(source: string) => void} [options.onEnded] - a source stopped: the worker ended the share, say
 * @returns {Promise<{
 *   audio: { encoding: string, sampleRateHertz: number, channelCount: number },
 *   chunks: AsyncIterable<ArrayBuffer>,
 *   levels: () => Record<string, number>,
 *   stop: () => Promise<void>,
 * }>} `audio` is what to give the client as its `audio` option; `levels`
 *   gives each source's loudness in dB, for meters.
 */
export async function captureAudio({
  microphone = true,
  sharedAudio = false,
  recording,
  sampleRateHertz = 16000,
  chunkMs = 100,
  onEnded = () => {},
} = {}) {
  const channelCount = recording || (microphone && sharedAudio) ? 2 : 1;
  if (!recording && !microphone && !sharedAudio) throw new Error('Capture the microphone, shared audio, or a recording');

  const context = new AudioContext({ sampleRate: sampleRateHertz });
  if (context.sampleRate !== sampleRateHertz) {
    await context.close();
    throw new Error(`This browser ran audio at ${context.sampleRate} Hz, not ${sampleRateHertz} Hz`);
  }
  await context.resume();

  const merger = context.createChannelMerger(channelCount);
  const streams = [];
  const meters = {};
  const meter = (name, node, output = 0) => {
    const analyser = context.createAnalyser();
    node.connect(analyser, output);
    meters[name] = { analyser, buffer: new Float32Array(analyser.fftSize) };
  };
  const live = (stream, name, channel) => {
    streams.push(stream);
    for (const track of stream.getTracks()) track.addEventListener('ended', () => onEnded(name));
    const source = context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    source.connect(merger, 0, channel);
    meter(name, source);
  };

  let player = null;
  try {
    if (recording) {
      player = context.createBufferSource();
      const bytes = recording instanceof ArrayBuffer ? recording : await recording.arrayBuffer();
      player.buffer = await context.decodeAudioData(bytes);
      const splitter = context.createChannelSplitter(2);
      player.connect(splitter);
      // Played out loud in mono, so it sounds centered; the channels stay apart for transcribing.
      player.connect(new GainNode(context, { channelCount: 1, channelCountMode: 'explicit' })).connect(context.destination);
      for (const [name, channel] of [['worker', 0], ['applicant', 1]]) {
        splitter.connect(merger, channel, channel);
        meter(name, splitter, channel);
      }
    } else {
      if (microphone) {
        live(await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        }), 'worker', 0);
      }
      if (sharedAudio) {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
          systemAudio: 'include',
          selfBrowserSurface: 'exclude',
        });
        if (!stream.getAudioTracks().length) {
          for (const track of stream.getTracks()) track.stop();
          throw new Error('The share had no audio. Share the window or tab with the call, and include its audio.');
        }
        live(stream, 'applicant', microphone ? 1 : 0);
      }
    }

    // Pages opened from disk can't load a worklet from a Blob URL; a data URL works.
    const source = `(${processor})(${createInterleaver})`;
    await context.audioWorklet.addModule(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
  } catch (error) {
    for (const stream of streams) for (const track of stream.getTracks()) track.stop();
    await context.close();
    throw error;
  }

  const chunks = createChunkQueue();
  const node = new AudioWorkletNode(context, 'blueprint-linear16', {
    channelCount,
    channelCountMode: 'explicit',
    processorOptions: { channelCount, chunkFrames: Math.round((sampleRateHertz * chunkMs) / 1000) },
  });
  node.port.onmessage = (event) => chunks.push(event.data);
  // A silent sink keeps the graph pulling audio without playing the microphone back.
  const silent = context.createGain();
  silent.gain.value = 0;
  merger.connect(node).connect(silent).connect(context.destination);
  player?.start();

  return {
    audio: { encoding: ENCODING, sampleRateHertz, channelCount },
    chunks,
    levels() {
      const result = {};
      for (const [name, { analyser, buffer }] of Object.entries(meters)) {
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (const x of buffer) sum += x * x;
        result[name] = sum ? 10 * Math.log10(sum / buffer.length) : -Infinity;
      }
      return result;
    },
    async stop() {
      for (const stream of streams) for (const track of stream.getTracks()) track.stop();
      player?.stop();
      chunks.end();
      await context.close();
    },
  };
}
