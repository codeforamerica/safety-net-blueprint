/**
 * Amazon Transcribe's side of the WebSocket, for the demo: a class with the
 * WebSocket interface the Amazon Transcribe adapter uses, so the adapter runs
 * as it would against Transcribe, with no AWS account. It takes AudioEvent
 * messages and answers with TranscriptEvent messages, both in AWS's event
 * stream format, playing back a recording (src/recording.js) as Transcribe's
 * results: a line in progress as a partial result, a finished line as a final
 * one, and a drop as the connection closing.
 * https://docs.aws.amazon.com/transcribe/latest/dg/websocket.html
 */

import { createPlayback } from '../src/recording.js';
import { encodeMessage, decodeMessage } from '../src/client/adapters/aws/eventstream.js';

const encoder = new TextEncoder();
const RESULT_HEADERS = { ':content-type': 'application/json', ':event-type': 'TranscriptEvent', ':message-type': 'event' };

/** A recording's line as Transcribe's result: its words as items, each with the speaker. */
function resultOf(line, partial) {
  const words = line.text.split(/\s+/);
  const end = line.end ?? line.start + words.length * 0.3;
  const step = (end - line.start) / words.length;
  const speaker = line.speakerLabel?.replace(/^spk_/, '');
  return {
    ResultId: line.key,
    StartTime: line.start,
    EndTime: end,
    IsPartial: partial,
    LanguageCode: 'en-US',
    Alternatives: [{
      Transcript: line.text,
      Items: words.map((word, i) => ({
        Type: 'pronunciation',
        Content: word.replace(/[^\w']/g, ''),
        StartTime: +(line.start + i * step).toFixed(2),
        EndTime: +(line.start + (i + 1) * step).toFixed(2),
        ...(speaker !== undefined && { Speaker: speaker }),
        ...(!partial && line.confidence !== undefined && { Confidence: line.confidence }),
      })),
    }],
  };
}

/**
 * @param {{ events: object[] }} recording
 * @param {object} options
 * @param {number} [options.speed]
 * @param {Function} [options.sleep] - waits a number of milliseconds
 * @param {(what: string, detail: object) => void} [options.tap] - told of
 *   each thing that crosses: `open` ({ url }), `audio` ({ bytes }), `end`,
 *   `result` ({ result }), `close` ({ finished })
 * @returns {typeof EventTarget} a WebSocket class for createAwsTranscribeAdapter
 */
export function createFakeTranscribe(recording, { speed, sleep, tap = () => {} } = {}) {
  const playback = createPlayback(recording, { speed, sleep });

  return class FakeTranscribe extends EventTarget {
    #playing = null;

    constructor(url) {
      super();
      this.url = url;
      this.readyState = 0;
      this.binaryType = 'arraybuffer';
      tap('open', { url });
      setTimeout(() => {
        this.readyState = 1;
        this.dispatchEvent(new Event('open'));
        this.#playing = playback.play((type, line) => {
          if (type === 'drop') this.#close(false);
          else if (type === 'update' || type === 'add') this.#result(line, type === 'update');
        });
      });
    }

    send(data) {
      if (this.readyState !== 1) return;
      const message = decodeMessage(data);
      // An empty AudioEvent ends the audio: Transcribe sends its last results and closes.
      if (message.payload.length === 0) {
        tap('end', {});
        this.#playing?.stop().then(() => this.#close(true));
        return;
      }
      tap('audio', { bytes: message.payload.length });
    }

    close() { this.#close(true); }

    #result(line, partial) {
      const result = resultOf(line, partial);
      tap('result', { result });
      const payload = encoder.encode(JSON.stringify({ Transcript: { Results: [result] } }));
      this.dispatchEvent(new MessageEvent('message', { data: encodeMessage(RESULT_HEADERS, payload).buffer }));
    }

    #close(finished) {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.#playing?.stop();
      tap('close', { finished });
      this.dispatchEvent(new Event('close'));
    }
  };
}
