/**
 * Speech to text in the page, for the relay in this page (in-page-relay.js):
 * OpenAI's Whisper, tiny English model (MIT code, Apache-2.0 weights), run by
 * Hugging Face's transformers.js (Apache-2.0) on ONNX Runtime Web.
 *
 * Nothing is bundled with the explorer. The library comes from jsDelivr and
 * the model from Hugging Face the first time someone chooses the relay in this
 * page, about 47 MB, and the browser keeps them for the next time. The audio
 * never leaves the page. It works on a page opened from disk, as the
 * explorer is.
 */

const LIBRARY = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2';
// The timestamped export gives each word's start and end.
const MODEL = 'onnx-community/whisper-tiny.en_timestamped';

/** The rate Whisper hears at. */
export const WHISPER_RATE = 16000;

let loading = null;

/**
 * A transcriber, loaded once per page.
 *
 * @returns {Promise<(samples: Float32Array) => Promise<{ text: string, words: Array<{ word: string, startMs: number, endMs: number }> }>>}
 *   Mono samples at WHISPER_RATE in, what was said and when each word was out
 */
export function loadWhisper() {
  loading ??= (async () => {
    // A URL in a variable, so the bundle leaves the import to the page.
    const library = LIBRARY;
    const { pipeline } = await import(library);
    const recognize = await pipeline('automatic-speech-recognition', MODEL, { dtype: 'q8' });
    return async (samples) => {
      const result = await recognize(samples, { return_timestamps: 'word' });
      return {
        text: String(result.text ?? '').trim(),
        words: (result.chunks ?? []).map((chunk) => ({
          word: String(chunk.text).trim(),
          startMs: Math.round((chunk.timestamp?.[0] ?? 0) * 1000),
          endMs: Math.round((chunk.timestamp?.[1] ?? chunk.timestamp?.[0] ?? 0) * 1000),
        })).filter((w) => w.word),
      };
    };
  })();
  // A failed load can be tried again.
  loading.catch(() => { loading = null; });
  return loading;
}
