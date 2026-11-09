/**
 * A fake relay, in the testing sense: a working relay with no transcription
 * service behind it. It speaks the relay contract,
 * communication-transcripts-relay-asyncapi.yaml, and plays back a recording
 * as the service's results, for demos and tests of software that talks to a
 * relay. The recording's format is in src/recording.js.
 *
 * It runs in whatever WebSocket server the host has, by the two hooks the `ws`
 * package names: `handleProtocols`, which chooses the subprotocol or refuses
 * the connection, and `handleConnection`, for each socket once it's open — a
 * socket as `ws` gives it, with `send`, `close`, `readyState` and
 * `on('message' | 'close')`:
 *
 *   const relay = createFakeRelay(recording);
 *
 *   // Node, with ws
 *   const wss = new WebSocketServer({ port, handleProtocols: relay.handleProtocols });
 *   wss.on('connection', relay.handleConnection);
 *
 *   // In a page, with mock-socket
 *   const server = new Server(url, { selectProtocol: relay.handleProtocols });
 *   server.on('connection', relay.handleConnection);
 *
 *   // In a worker, from a page: serveWebSocketOverPort (socket.js)
 *
 * A real relay checks the token as a JWT the transcripts adapter signed; the
 * fake takes any token `verifyToken` accepts, by default any at all.
 */

import { RELAY_PROTOCOL } from '../relay-protocol.js';
import { createPlayback } from '../recording.js';

const ms = (seconds) => Math.round((seconds ?? 0) * 1000);

/**
 * @param {{ events: object[] }} recording
 * @param {object} [options]
 * @param {number} [options.speed] - 2 plays twice as fast.
 * @param {Function} [options.sleep] - waits a number of milliseconds.
 * @param {(token: string) => boolean} [options.verifyToken]
 */
export function createFakeRelay(recording, { verifyToken = (token) => Boolean(token), ...options } = {}) {
  const playback = createPlayback(recording, options);

  return {
    /**
     * The subprotocol to answer an upgrade with, or false to refuse it, as
     * `ws`'s handleProtocols: the relay's own, offered first, with a token
     * after it that's accepted.
     *
     * @param {Set<string>|string[]} offered - the Sec-WebSocket-Protocol values, in order
     * @returns {string|false}
     */
    handleProtocols(offered) {
      const [protocol, token] = [...(offered ?? [])];
      return protocol === RELAY_PROTOCOL && verifyToken(token) ? RELAY_PROTOCOL : false;
    },

    /** Speak the relay contract on an open connection, as `ws`'s connection event gives it. */
    handleConnection(socket) {
      let playing = null;
      let ended = false;
      const send = (message) => { if (socket.readyState === 1) socket.send(JSON.stringify(message)); };
      const fail = (code, message) => {
        send({ type: 'error', code, message });
        playing?.stop();
        socket.close();
      };

      const result = (line, isFinal) => send({
        type: 'result',
        id: line.key,
        isFinal,
        startOffsetMs: ms(line.start),
        endOffsetMs: ms(line.end ?? line.start),
        ...(line.speakerLabel !== undefined && { speaker: line.speakerLabel }),
        ...(line.language !== undefined && { language: line.language }),
        alternatives: [{ transcript: line.text, ...(line.confidence !== undefined && { confidence: line.confidence }) }],
      });

      // ws gives text as a Buffer it marks not binary; mock-socket gives a string.
      socket.on('message', (data, isBinary) => {
        const text = typeof data === 'string' ? data : isBinary === false ? new TextDecoder().decode(data) : null;
        // Audio arrives as binary frames, and a fake has nothing to do with it.
        if (text === null) {
          if (!playing) fail('bad-message', 'Audio came before start');
          return;
        }
        let message;
        try {
          message = JSON.parse(text);
        } catch {
          fail('bad-message', 'A message isn\'t JSON');
          return;
        }
        if (message.type === 'start') {
          if (playing) return fail('bad-message', 'start came twice');
          if (!message.audio?.encoding || !message.audio?.sampleRateHertz || !message.audio?.channelCount) {
            return fail('bad-message', 'start needs the audio\'s encoding, sampleRateHertz and channelCount');
          }
          send({ type: 'started' });
          const interim = message.interimResults !== false;
          playing = playback.play((type, line) => {
            if (type === 'update' && interim) result(line, false);
            else if (type === 'add') result(line, true);
            else if (type === 'drop') socket.close();
          });
        } else if (message.type === 'end') {
          if (ended) return;
          ended = true;
          Promise.resolve(playing?.stop()).then(() => {
            send({ type: 'ended' });
            socket.close();
          });
        } else if (message.type === 'keepalive' || message.type === 'finalize') {
          // Nothing to keep alive or finish behind a fake.
        } else {
          fail('bad-message', `No message has type ${JSON.stringify(message.type)}`);
        }
      });

      socket.on('close', () => { playing?.stop(); });
    },
  };
}
