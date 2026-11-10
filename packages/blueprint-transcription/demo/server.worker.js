/**
 * The demo's state side, in a web worker apart from the page, as a state's
 * server is apart from the worker's browser: the server's mock, holding the
 * transcripts, with a routing handler standing in for the transcripts
 * adapter, and the fake relay standing in for a relay and the service behind
 * it. The page reaches it through the mock server's worker entry: requests by
 * `server.fetch`, the relay by `server.connect('relay')`, and `control` for
 * the demo's own settings.
 */

import { createMockServer } from '@codeforamerica/blueprint-mock-server/browser';
import { expose } from '@codeforamerica/blueprint-mock-server/worker';
import contracts from '../../blueprint-harness/generated/mock/contracts.json';
import script from './interview.md';
import { recordingFromScript } from './script-to-recording.js';
import { createFakeRelay, serveWebSocketOverPort } from '../src/fakes/index.js';
import { RELAY_PROTOCOL } from '../src/relay-protocol.js';

console.log = () => {};
console.warn = () => {};

// Built while the page boots; requests wait for it.
const mock = createMockServer({
  contracts,
  routing: [{
    operation: 'issueTranscriptConnection',
    // Stands in for the state's transcripts adapter, which holds the vendor's
    // secret and hands out a short-lived pass: to the relay for a service a
    // browser can't reach, straight to the vendor otherwise.
    handler: async (request) => {
      const { metadata, provider } = await request.json();
      return Response.json({
        metadata,
        ...(provider === 'google-cloud-speech'
          ? { provider, protocol: 'websocket', url: 'wss://relay.example', subprotocol: RELAY_PROTOCOL, accessToken: 'demo-token', tokenType: 'Bearer', expiresIn: 60 }
          : { provider, protocol: 'websocket', url: 'wss://vendor.example', expiresIn: 300 }),
      });
    },
  }],
});

// The page sets the relay's speed when a run starts, and decides when it may
// carry on: before each wait in the recording, the relay asks, so stepping
// in the page holds it after a sentence.
let control = null;
let relay = null;
const asking = new Map();
let asks = 0;
const mayContinue = () => new Promise((resolve) => {
  if (!control) { resolve(); return; }
  asks += 1;
  asking.set(asks, resolve);
  control.postMessage({ type: 'sleep', id: asks });
});
const sleep = async (ms) => {
  await mayContinue();
  await new Promise((resolve) => setTimeout(resolve, ms));
};

expose({
  fetch: async (request) => (await mock).fetch(request),
  connections: {
    relay: (port) => serveWebSocketOverPort(port, relay),
    control: (port) => {
      control = port;
      port.onmessage = ({ data: message }) => {
        if (message.type === 'configure') {
          relay = createFakeRelay(recordingFromScript(script, { beats: message.beats }), { speed: message.speed, sleep });
          port.postMessage({ type: 'configured' });
        } else if (message.type === 'go') {
          asking.get(message.id)?.();
          asking.delete(message.id);
        }
      };
    },
  },
});
