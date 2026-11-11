/**
 * The WebSockets a contract set's AsyncAPI documents describe, served by the
 * mock, and the WebSocket stubs that answer on them.
 *
 * An AsyncAPI document with `servers` describes a party reached over its own
 * connection, such as the transcription relay
 * (communication-transcripts-relay-asyncapi.yaml). The mock serves each such
 * document's channel as a WebSocket at `/mock/ws/{document}`, by the
 * document's file name. It answers nothing on its own, as it answers no HTTP
 * call it can't work out from the contracts: what comes back is what a
 * WebSocket stub says, registered at `POST /mock/stubs/ws` and consumed by
 * the first message it matches, as an HTTP stub is by the first request.
 *
 * Every message is checked against the contract, both ways. One that arrives
 * and is none of the messages the mock receives on the channel closes the
 * connection with 1007, invalid data; a stub that would send something the
 * contract doesn't let the mock send is refused when it's registered. A
 * message whose operation declares a `reply`, with no stub to give one,
 * closes the connection with 1011, naming the stub it needs, as an HTTP call
 * the mock can't answer is a 501.
 *
 * In a page or a test, `WebSocket` is a class with the standard interface
 * that connects to these in-process, for software or a scenario to use as it
 * would the browser's.
 */

import { operationsOf, messageChecker, recognize, isBinary } from './asyncapi-messages.js';
import { assertValid, dotted } from './mock-schemas.js';
import { resolveDotPath } from './collection-utils.js';
import schema from '../schemas/stubs-schema.json' with { type: 'json' };

/** Where the mock serves a document's WebSocket. */
export const WS_PATH = '/mock/ws/';

const fileName = (path) => String(path ?? '').split('/').pop();

/**
 * @param {import('@codeforamerica/blueprint-core').Doc[]} [docs]
 */
export function createWs(docs = []) {
  const check = messageChecker(docs ?? []);

  // Each document reached over its own connection, by file name: which
  // messages the mock receives on each channel, which it may send, and which
  // received messages want a reply.
  const served = new Map();
  for (const doc of docs ?? []) {
    if (doc.type !== 'asyncapi' || !doc.relativePath) continue;
    if (!doc.content?.servers || Object.keys(doc.content.servers).length === 0) continue;
    const channels = new Map();
    const channelOf = (name) => {
      if (!channels.has(name)) channels.set(name, { receives: [], sends: [], replies: new Map() });
      return channels.get(name);
    };
    for (const operation of operationsOf(doc.content).values()) {
      const channel = channelOf(operation.channel);
      if (operation.action === 'receive') {
        channel.receives.push(...operation.messages);
        for (const message of operation.messages) if (operation.reply.length) channel.replies.set(message.name, operation.reply);
      } else {
        channel.sends.push(...operation.messages);
      }
      for (const reply of operation.reply) channelOf(reply.channel).sends.push(reply);
    }
    served.set(fileName(doc.relativePath), { relativePath: doc.relativePath, channels });
  }

  const stubs = [];
  const counters = new Map();

  /** The document and channel a stub names: `relay-asyncapi.yaml#/channels/audio`. */
  function channelNamed(ref) {
    const m = /^([^#]+)#\/channels\/(.+)$/.exec(String(ref ?? ''));
    const document = m && served.get(fileName(m[1]));
    const channel = document?.channels.get(m[2].replace(/~1/g, '/').replace(/~0/g, '~'));
    return channel ? { document, channel, name: m[2] } : null;
  }

  /**
   * Register a WebSocket stub: on a message the mock receives, send these.
   * Refused when the channel isn't one the mock serves, `on` isn't a message
   * it receives there, or something to send isn't a message it may send.
   */
  function registerStub(stub) {
    assertValid(schema.definitions.WsStub, stub, (pointer) => ['WebSocket stub', dotted(pointer)]);
    const found = channelNamed(stub.channel);
    if (!found) {
      throw new Error(`WebSocket stub "channel" ${stub.channel} isn't a channel of a document the mock serves a WebSocket for: ${[...served.keys()].join(', ') || 'none'}`);
    }
    if (!found.channel.receives.some((m) => m.name === stub.on)) {
      throw new Error(`WebSocket stub "on" ${stub.on} isn't a message the mock receives on ${stub.channel}: ${found.channel.receives.map((m) => m.name).join(', ')}`);
    }
    for (const [index, payload] of (stub.send ?? []).entries()) {
      const { message, reasons } = recognize(check, found.document.relativePath, found.channel.sends, JSON.stringify(payload));
      if (!message) throw new Error(`WebSocket stub "send.${index}" isn't a message the mock may send on ${stub.channel}: ${reasons.join('; ')}`);
    }
    const n = (counters.get(stub.on) ?? 0) + 1;
    counters.set(stub.on, n);
    const registered = { ...stub, type: 'ws', id: `ws.${stub.on}-${n}` };
    stubs.push(registered);
    return registered;
  }

  /**
   * The first stub for this message, removed: it answers once. One naming
   * `protocols` matches only a connection that offered each of them.
   */
  function takeStub(document, channelName, message, payload, offered) {
    const at = stubs.findIndex((s) => {
      const named = channelNamed(s.channel);
      if (named?.document !== document || named.name !== channelName || s.on !== message.name) return false;
      if (!(s.protocols ?? []).every((protocol) => offered.includes(protocol))) return false;
      return Object.entries(s.match ?? {}).every(([path, expected]) => resolveDotPath(payload, path) === expected);
    });
    return at === -1 ? null : stubs.splice(at, 1)[0];
  }

  /**
   * Serve one connection: `peer` is the far end, with `send(data)` and
   * `close(code, reason)`, and `offered` the subprotocols it asked for.
   * Returns what to call with each frame that arrives.
   */
  function accept(path, peer, offered = []) {
    const document = served.get(decodeURIComponent(String(path).slice(WS_PATH.length)));
    if (!document) {
      peer.close(1008, `The mock serves no WebSocket at ${path}`);
      return () => {};
    }
    // A document's channel; one with more would need choosing, and none does yet.
    const [[channelName, channel]] = [...document.channels.entries()];
    return (data) => {
      const { message, reasons } = recognize(check, document.relativePath, channel.receives, data);
      if (!message) {
        peer.close(1007, `Not a message the contract lets the mock receive: ${reasons.join('; ')}`);
        return;
      }
      const payload = isBinary(data) ? null : JSON.parse(data);
      const stub = takeStub(document, channelName, message, payload, offered);
      if (stub) {
        for (const reply of stub.send ?? []) peer.send(JSON.stringify(reply));
        // A dropped connection, or one refused, after what it sent.
        if (stub.close) peer.close(stub.close.code, stub.close.reason ?? '');
        return;
      }
      if (channel.replies.has(message.name)) {
        peer.close(1011, `${message.name} is answered with ${channel.replies.get(message.name).map((m) => m.name).join(' or ')}, and no WebSocket stub gives one; register one at POST /mock/stubs/ws`);
      }
    };
  }

  /**
   * A WebSocket, with the standard interface, connected in-process to the
   * mock: `new WebSocket('ws://mock/mock/ws/<document>')`.
   */
  class MockWebSocket extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url, protocols = []) {
      super();
      this.url = String(url);
      this.protocol = [].concat(protocols)[0] ?? '';
      this.binaryType = 'blob';
      this.readyState = MockWebSocket.CONNECTING;
      this.onopen = null; this.onmessage = null; this.onclose = null; this.onerror = null;
      const fire = (type, init = {}) => {
        const event = Object.assign(new Event(type), init);
        this[`on${type}`]?.(event);
        this.dispatchEvent(event);
      };
      this._closed = (code, reason) => {
        if (this.readyState === MockWebSocket.CLOSED) return;
        this.readyState = MockWebSocket.CLOSED;
        fire('close', { code, reason, wasClean: code === 1000 });
      };
      const peer = {
        // Delivered after the frame that caused it, as a network would.
        send: (reply) => queueMicrotask(() => { if (this.readyState === MockWebSocket.OPEN) fire('message', { data: reply }); }),
        close: (code, reason) => queueMicrotask(() => this._closed(code, reason)),
      };
      queueMicrotask(() => {
        this._take = accept(new URL(this.url, 'ws://mock').pathname, peer, [].concat(protocols));
        if (this.readyState !== MockWebSocket.CONNECTING) return;
        this.readyState = MockWebSocket.OPEN;
        fire('open');
      });
    }

    send(data) {
      if (this.readyState !== MockWebSocket.OPEN) throw new Error('The WebSocket is not open');
      this._take(data);
    }

    close(code = 1000, reason = '') {
      if (this.readyState >= MockWebSocket.CLOSING) return;
      this.readyState = MockWebSocket.CLOSING;
      queueMicrotask(() => this._closed(code, reason));
    }
  }

  return {
    WebSocket: MockWebSocket,
    accept,
    registerStub,
    listStubs: () => [...stubs],
    clearStubs: () => { stubs.length = 0; counters.clear(); },
    removeStub: (id) => {
      const at = stubs.findIndex((s) => s.id === id);
      if (at === -1) return false;
      stubs.splice(at, 1);
      return true;
    },
  };
}
