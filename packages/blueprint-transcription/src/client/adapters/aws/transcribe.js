/**
 * A client adapter for Amazon Transcribe streaming. It opens the presigned
 * WebSocket URL the transcript audio adapter issued, sends the audio as
 * AudioEvent messages, and reports each TranscriptEvent's results: a partial
 * result as a line in progress, a final one as a finished line, keyed by
 * Transcribe's ResultId so the two are tied.
 * https://docs.aws.amazon.com/transcribe/latest/dg/websocket.html
 *
 * The audio is whatever the page captured, as an async iterable of chunks in
 * the format the session asked for (16-bit PCM for linear16): this adapter
 * frames it and sends it, nothing more.
 */

import { encodeMessage, decodeMessages } from './eventstream.js';

const AUDIO_HEADERS = { ':content-type': 'application/octet-stream', ':event-type': 'AudioEvent', ':message-type': 'event' };
const decoder = new TextDecoder();

const bytes = (chunk) => (chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));

/** The speaker of most of a result's words, or its channel, as Transcribe labels them. */
function speakerLabelOf(result, alternative) {
  if (result.ChannelId) return result.ChannelId;
  const counts = new Map();
  for (const item of alternative.Items ?? []) {
    if (item.Speaker !== undefined) counts.set(item.Speaker, (counts.get(item.Speaker) ?? 0) + 1);
  }
  if (!counts.size) return undefined;
  const [label] = [...counts].sort((a, b) => b[1] - a[1])[0];
  return `spk_${label}`;
}

/** The mean of the words' confidences, where Transcribe gives them. */
function confidenceOf(alternative) {
  const scores = (alternative.Items ?? []).filter((i) => i.Type === 'pronunciation' && typeof i.Confidence === 'number').map((i) => i.Confidence);
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : undefined;
}

/**
 * @param {object} [options]
 * @param {Function} [options.WebSocket] - the WebSocket class; the global one by default
 * @param {number} [options.finishTimeoutMs] - how long to wait for the last results after the end of the audio
 */
export function createAwsTranscribeAdapter({ WebSocket: Socket = globalThis.WebSocket, finishTimeoutMs = 10_000 } = {}) {
  return {
    open({ connection, chunks, report }) {
      return new Promise((resolve, reject) => {
        const socket = new Socket(connection.url);
        socket.binaryType = 'arraybuffer';
        let opened = false;
        let finishing = false;
        let closed;
        const whenClosed = new Promise((done) => { closed = done; });

        const send = (payload) => {
          if (socket.readyState === 1) socket.send(encodeMessage(AUDIO_HEADERS, payload));
        };

        async function pump() {
          try {
            for await (const chunk of chunks ?? []) {
              if (finishing || socket.readyState !== 1) return;
              send(bytes(chunk));
            }
          } catch (error) {
            console.error('Transcribe: the audio failed', error);
          }
        }

        socket.addEventListener('open', () => {
          opened = true;
          pump();
          resolve({
            // An empty AudioEvent ends the stream; Transcribe sends its last
            // results and closes the connection.
            async finish() {
              if (finishing) return whenClosed;
              finishing = true;
              send(new Uint8Array(0));
              const timer = setTimeout(() => socket.close(), finishTimeoutMs);
              await whenClosed;
              clearTimeout(timer);
            },
          });
        });

        socket.addEventListener('message', (event) => {
          let messages;
          try {
            messages = decodeMessages(event.data);
          } catch (error) {
            console.error('Transcribe: a message couldn\'t be read', error);
            return;
          }
          for (const message of messages) {
            const type = message.headers[':message-type'];
            // Transcribe ends the stream after an exception; closing makes it
            // a drop, which the driver reconnects from.
            if (type === 'exception') {
              console.error(`Transcribe: ${message.headers[':exception-type']}: ${decoder.decode(message.payload)}`);
              socket.close();
              return;
            }
            if (type === 'event' && message.headers[':event-type'] === 'TranscriptEvent') results(message);
          }
        });

        function results(message) {
          for (const result of JSON.parse(decoder.decode(message.payload))?.Transcript?.Results ?? []) {
            const alternative = result.Alternatives?.[0];
            if (!alternative?.Transcript) continue;
            const line = {
              key: result.ResultId,
              text: alternative.Transcript,
              start: result.StartTime,
              speakerLabel: speakerLabelOf(result, alternative),
            };
            if (line.speakerLabel === undefined) delete line.speakerLabel;
            if (result.IsPartial) {
              report.update(line);
            } else {
              const confidence = confidenceOf(alternative);
              report.add({
                ...line,
                end: result.EndTime,
                ...(confidence !== undefined && { confidence }),
                ...(result.LanguageCode && { language: result.LanguageCode }),
              });
            }
          }
        }

        socket.addEventListener('error', (error) => {
          if (!opened) reject(new Error(`Transcribe: the connection didn't open${error?.message ? `: ${error.message}` : ''}`));
        });

        // A close nobody asked for is a drop.
        socket.addEventListener('close', () => {
          closed();
          if (!opened) reject(new Error('Transcribe: the connection closed before it opened'));
          else if (!finishing) report.dropped();
        });
      });
    },
  };
}
