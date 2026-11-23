/**
 * Text to speech in the page, for typed lines on a transcription session's
 * connect: Kokoro-82M (Apache-2.0), run by kokoro-js (Apache-2.0) on
 * ONNX Runtime Web.
 *
 * Nothing is bundled with the explorer. The library comes from jsDelivr and
 * the model from Hugging Face the first time someone speaks typed lines, and
 * the browser keeps them for the next time. kokoro-js turns text into speech
 * sounds with eSpeak NG (GPL-3), compiled to WebAssembly: loaded from the CDN,
 * the explorer doesn't distribute it, but a site that hosts these files
 * itself takes on the GPL's terms for it.
 *
 * With WebGPU, the full model (326 MB), as kokoro-js advises for the GPU;
 * otherwise the 8-bit one (92 MB), on the CPU, which makes about a second of
 * speech in two. Works on a page opened from disk.
 */

const LIBRARY = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm';
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

/** American English voices, the best rated first, as the model card grades them. */
export const VOICES = [
  { id: 'af_heart', name: 'Heart' },
  { id: 'af_bella', name: 'Bella' },
  { id: 'am_michael', name: 'Michael' },
  { id: 'am_fenrir', name: 'Fenrir' },
  { id: 'af_nicole', name: 'Nicole' },
  { id: 'am_puck', name: 'Puck' },
];

let loading = null;

/**
 * The speaker, loaded once per page.
 *
 * @returns {Promise<{ device: 'webgpu'|'wasm', speak: (text: string, voice: string) => Promise<{ samples: Float32Array, rate: number }> }>}
 */
export function loadKokoro() {
  loading ??= (async () => {
    // A URL in a variable, so the bundle leaves the import to the page.
    const library = LIBRARY;
    const { KokoroTTS } = await import(library);
    const device = (await navigator.gpu?.requestAdapter().catch(() => null)) ? 'webgpu' : 'wasm';
    const tts = await KokoroTTS.from_pretrained(MODEL, { dtype: device === 'webgpu' ? 'fp32' : 'q8', device });
    return {
      device,
      async speak(text, voice) {
        const audio = await tts.generate(text, { voice });
        return { samples: audio.audio, rate: audio.sampling_rate };
      },
    };
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

// Silence between lines, longer than an adapter's pause between lines.
const BETWEEN_MS = 900;

/**
 * Lines spoken in turn, the voices taking turns, as a WAV recording.
 *
 * @param {string[]} lines
 * @param {string[]} voices - One for each speaker, used in turn
 * @param {(progress: { line: number, of: number, device: string, speechSeconds: number, makingSeconds: number }) => void} [onProgress]
 * @returns {Promise<{ recording: Blob, device: string, speechSeconds: number, makingSeconds: number, loadingSeconds: number }>}
 */
export async function speakLines(lines, voices, onProgress = () => {}) {
  const loadingStarted = performance.now();
  const { device, speak } = await loadKokoro();
  const loadingSeconds = (performance.now() - loadingStarted) / 1000;
  const spoken = [];
  let rate = 24000;
  let speechSeconds = 0;
  let makingSeconds = 0;
  for (const [i, text] of lines.entries()) {
    const started = performance.now();
    const { samples, rate: given } = await speak(text, voices[i % voices.length]);
    makingSeconds += (performance.now() - started) / 1000;
    rate = given;
    speechSeconds += samples.length / rate;
    spoken.push(samples);
    onProgress({ line: i + 1, of: lines.length, device, speechSeconds, makingSeconds });
  }
  const gap = Math.round(rate * BETWEEN_MS / 1000);
  const length = spoken.reduce((sum, samples) => sum + samples.length + gap, gap);
  const all = new Float32Array(length);
  let at = gap;
  for (const samples of spoken) { all.set(samples, at); at += samples.length + gap; }
  return { recording: wav(all, rate), device, speechSeconds, makingSeconds, loadingSeconds };
}

/** Mono samples as a 16-bit PCM WAV file. */
function wav(samples, rate) {
  const bytes = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at, value) => { for (let i = 0; i < value.length; i += 1) bytes.setUint8(at + i, value.charCodeAt(i)); };
  text(0, 'RIFF');
  bytes.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  bytes.setUint32(16, 16, true);
  bytes.setUint16(20, 1, true);
  bytes.setUint16(22, 1, true);
  bytes.setUint32(24, rate, true);
  bytes.setUint32(28, rate * 2, true);
  bytes.setUint16(32, 2, true);
  bytes.setUint16(34, 16, true);
  text(36, 'data');
  bytes.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const clipped = Math.max(-1, Math.min(1, samples[i]));
    bytes.setInt16(44 + i * 2, clipped < 0 ? clipped * 32768 : clipped * 32767, true);
  }
  return new Blob([bytes.buffer], { type: 'audio/wav' });
}
