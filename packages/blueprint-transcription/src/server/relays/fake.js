/**
 * A fake relay, in the testing sense: a working relay with no transcription
 * service behind it. It speaks the relay contract,
 * communication-transcripts-relay-asyncapi.yaml, and plays back a recording
 * as the service's results, for demos and tests of software that talks to a
 * relay. The recording's format is in src/recording.js.
 *
 * It's given each connection's socket rather than running a server, so it
 * works with whatever WebSocket server the host has — the `ws` package in
 * Node, Deno's or Bun's, a worker's — as long as the socket has `send`,
 * `close`, `readyState` and `addEventListener('message' | 'close')`:
 *
 *   const relay = createFakeRelay(recording);
 *   // On an upgrade request, answer with the protocol it chooses, or refuse:
 *   const protocol = relay.protocolFor(offeredProtocols);
 *   // Once the connection is open:
 *   relay.accept(socket);
 *
 * A real relay checks the token as a JWT the transcripts adapter signed; the
 * fake takes any token `verifyToken` accepts, by default any at all.
 */

import { RELAY_PROTOCOL } from '../../relay-protocol.js';
import { createPlayback } from '../../recording.js';

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
     * The subprotocol to answer an upgrade with, or null to refuse it: the
     * relay's own, offered first, with a token after it that's accepted.
     *
     * @param {string[]} offered - the Sec-WebSocket-Protocol values, in order
     */
    protocolFor(offered) {
      const [protocol, token] = offered ?? [];
      return protocol === RELAY_PROTOCOL && verifyToken(token) ? RELAY_PROTOCOL : null;
    },

    /** Speak the relay contract on an open connection. */
    accept(socket) {
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

      socket.addEventListener('message', (event) => {
        // Audio arrives as binary frames, and a fake has nothing to do with it.
        if (typeof event.data !== 'string') {
          if (!playing) fail('bad-message', 'Audio came before start');
          return;
        }
        let message;
        try {
          message = JSON.parse(event.data);
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

      socket.addEventListener('close', () => { playing?.stop(); });
    },
  };
}
