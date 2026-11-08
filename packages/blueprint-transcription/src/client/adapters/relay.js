/**
 * A client adapter for a relay: the page's side of the relay contract,
 * communication-transcripts-relay-asyncapi.yaml. A state runs a relay in front
 * of a service a browser can't reach, such as one that takes only gRPC, and
 * every relay speaks the same subprotocol, so this one adapter works with any
 * of them, whatever service is behind it. The driver chooses it by the
 * connection's subprotocol rather than its service.
 *
 * It opens the connection asking for the subprotocol, with the relay's token
 * beside it in Sec-WebSocket-Protocol — not in the URL, which is logged —
 * sends `start` with the audio's format, then the audio as binary frames, and
 * `end` when it's done. Results come back as JSON: one the service may still
 * revise is a line in progress, a final one a finished line, tied by `id`.
 */

import { RELAY_PROTOCOL } from '../../relay-protocol.js';

const bytes = (chunk) => (chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));

/**
 * @param {object} [options]
 * @param {Function} [options.WebSocket] - the WebSocket class; the global one by default
 * @param {number} [options.keepaliveMs] - how long without audio before a keepalive is sent
 * @param {number} [options.finishTimeoutMs] - how long to wait for `ended` after `end`
 */
export function createRelayAdapter({
  WebSocket: Socket = globalThis.WebSocket,
  keepaliveMs = 5_000,
  finishTimeoutMs = 10_000,
} = {}) {
  return {
    open({ connection, format, audio, report }) {
      return new Promise((resolve, reject) => {
        const protocols = [RELAY_PROTOCOL, ...(connection.accessToken ? [connection.accessToken] : [])];
        const socket = new Socket(connection.url, protocols);
        socket.binaryType = 'arraybuffer';
        let started = false;
        let finishing = false;
        let lastSent = Date.now();
        let keepalive = null;
        let closed;
        const whenClosed = new Promise((done) => { closed = done; });

        const send = (data) => {
          if (socket.readyState !== 1) return;
          socket.send(data);
          lastSent = Date.now();
        };
        const sendJson = (message) => send(JSON.stringify(message));

        async function pump() {
          try {
            for await (const chunk of audio ?? []) {
              if (finishing || socket.readyState !== 1) return;
              send(bytes(chunk));
            }
          } catch (error) {
            console.error('Relay: the audio failed', error);
          }
        }

        socket.addEventListener('open', () => {
          const parameters = connection.connectionParameters ?? {};
          sendJson({
            type: 'start',
            audio: format,
            ...(parameters.languages && { languages: parameters.languages }),
            ...(parameters.model && { model: parameters.model }),
            interimResults: true,
          });
        });

        socket.addEventListener('message', (event) => {
          if (typeof event.data !== 'string') return;
          let message;
          try {
            message = JSON.parse(event.data);
          } catch {
            console.error('Relay: a message isn\'t JSON');
            return;
          }
          if (message.type === 'started' && !started) {
            started = true;
            pump();
            // Browser code can't send WebSocket pings, so a quiet connection
            // is kept open with keepalive.
            keepalive = setInterval(() => {
              if (Date.now() - lastSent >= keepaliveMs) sendJson({ type: 'keepalive' });
            }, keepaliveMs);
            resolve({
              async finish() {
                if (finishing) return whenClosed;
                finishing = true;
                sendJson({ type: 'end' });
                const timer = setTimeout(() => socket.close(), finishTimeoutMs);
                await whenClosed;
                clearTimeout(timer);
              },
            });
          } else if (message.type === 'result') {
            const [best] = message.alternatives ?? [];
            if (!best?.transcript) return;
            const speakerLabel = message.speaker ?? (message.channel !== undefined ? `ch_${message.channel}` : undefined);
            const line = {
              key: message.id,
              text: best.transcript,
              start: message.startOffsetMs / 1000,
              ...(speakerLabel !== undefined && { speakerLabel }),
            };
            if (!message.isFinal) report.update(line);
            else {
              report.add({
                ...line,
                end: message.endOffsetMs / 1000,
                ...(best.confidence !== undefined && { confidence: best.confidence }),
                ...(message.language && { language: message.language }),
              });
            }
          } else if (message.type === 'error') {
            // The relay closes the connection after an error.
            console.error(`Relay: ${message.code}: ${message.message}`);
          }
        });

        socket.addEventListener('close', () => {
          clearInterval(keepalive);
          closed();
          if (!started) reject(new Error('Relay: the connection closed before the relay started'));
          else if (!finishing) report.dropped();
        });
      });
    },
  };
}
