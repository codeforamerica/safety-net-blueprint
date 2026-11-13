/**
 * The WebSockets a contract set's AsyncAPI documents describe, served by the
 * mock, and the WebSocket stubs that answer on them.
 *
 * An AsyncAPI document with `servers` describes a party reached over its own
 * connection, such as the transcription relay
 * (communication-transcripts-relay-asyncapi.yaml). The mock serves each
 * channel of one that lists a localhost server, at that server's `pathname`
 * and the channel's `address`, as it serves an OpenAPI document's paths under
 * its localhost server's. It answers nothing on its own, as it answers no HTTP
 * call it can't work out from the contracts: what comes back is what a
 * WebSocket stub says, registered at `POST /mock/stubs/ws` and consumed by
 * the first message it matches, as an HTTP stub is by the first request.
 * A stub can say when to send each message and when to close (`atMs`, from
 * when it matched), so it plays a script — a fake service's lines as they'd
 * be spoken, a connection that drops partway — and nothing more is sent once
 * either side closes.
 *
 * Every message is checked against the contract, both ways. One that arrives
 * and is none of the messages the mock receives on the channel closes the
 * connection with 1007, invalid data; a stub that would send something the
 * contract doesn't let the mock send is refused when it's registered. A
 * message whose operation declares a `reply`, with no stub to give one,
 * closes the connection with 1011, naming the stub it needs, as an HTTP call
 * the mock can't answer is a 501.
 *
 * Routing can send a document's connections elsewhere (routing.js): to a URL,
 * or to a `handler` with the WebSocket constructor's signature, as an HTTP
 * route goes to a URL or a function with fetch's. A stub still answers first;
 * the rest passes through, both ways, checked the same.
 *
 * In a page or a test, `WebSocket` is a class with the standard interface
 * that connects to these in-process, for software or a scenario to use as it
 * would the browser's. In Node, the server accepts real connections and hands
 * each to `accept` (http/node-server.js).
 */

import { operationsOf, messageChecker, recognize, isBinary, socketPaths } from './asyncapi-messages.js';
import { assertValid, dotted } from './mock-schemas.js';
import { resolveDotPath } from './collection-utils.js';
import schema from '../schemas/stubs-schema.json' with { type: 'json' };

const fileName = (path) => String(path ?? '').split('/').pop();

/** An API's name, as core gives it: the document's file name without its suffix. */
const apiName = (path) => fileName(path).replace(/-asyncapi\.ya?ml$/, '');

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Close codes that say the connection ended without one: a routed target's
 * that ended this way has failed, and the client is told so with 1014, Bad
 * Gateway (the IANA WebSocket close code registry).
 */
const ABNORMAL = new Set([1006, 1015]);

/** A code a WebSocket's `close()` takes: 1000, or one in the range applications use. */
const closable = (code) => (code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000);

/**
 * @param {import('@codeforamerica/blueprint-core').Doc[]} [docs]
 */
export function createWs(docs = []) {
  const check = messageChecker(docs ?? []);

  // Each document reached over its own connection, by file name: which
  // messages the mock receives on each channel, which it may send, and which
  // received messages want a reply. And each channel the mock serves, by the
  // path its document's localhost server gives it.
  const documents = new Map();
  const paths = new Map();
  for (const doc of docs ?? []) {
    if (doc.type !== 'asyncapi' || !doc.relativePath) continue;
    const served = socketPaths(doc.content);
    if (!served) continue;
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
    const document = { relativePath: doc.relativePath, api: apiName(doc.relativePath), channels, paths: [] };
    documents.set(fileName(doc.relativePath), document);
    for (const [name, path] of served) {
      if (!channels.has(name)) continue;
      const taken = paths.get(path);
      if (taken) {
        throw new Error(`${doc.relativePath} serves channel ${name} at ${path}, where ${taken.document.relativePath} already serves ${taken.name}; give one a different localhost pathname or channel address`);
      }
      paths.set(path, { document, name, channel: channels.get(name) });
      document.paths.push(path);
    }
  }

  const stubs = [];
  const counters = new Map();
  // Who answers a document's connections instead of its stubs, by API name.
  const routed = new Map();

  /** The document and channel a stub names: `relay-asyncapi.yaml#/channels/audio`. */
  function channelNamed(ref) {
    const m = /^([^#]+)#\/channels\/(.+)$/.exec(String(ref ?? ''));
    const document = m && documents.get(fileName(m[1]));
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
      throw new Error(`WebSocket stub "channel" ${stub.channel} isn't a channel of a document the mock serves a WebSocket for: ${[...documents.keys()].join(', ') || 'none'}`);
    }
    if (!found.channel.receives.some((m) => m.name === stub.on)) {
      throw new Error(`WebSocket stub "on" ${stub.on} isn't a message the mock receives on ${stub.channel}: ${found.channel.receives.map((m) => m.name).join(', ')}`);
    }
    for (const [index, payload] of (stub.send ?? []).entries()) {
      const { message, reasons } = recognize(check, found.document.relativePath, found.channel.sends, JSON.stringify(payload));
      if (!message) throw new Error(`WebSocket stub "send.${index}" isn't a message the mock may send on ${stub.channel}: ${reasons.join('; ')}`);
    }
    // Messages go in the order send lists them, so their times can't go back,
    // and a close can't come before the last of them.
    const at = stub.atMs ?? [];
    if (stub.atMs && at.length !== (stub.send ?? []).length) {
      throw new Error(`WebSocket stub "atMs" has ${at.length} times for ${(stub.send ?? []).length} messages in send; give one per message`);
    }
    const back = at.findIndex((ms, index) => index > 0 && ms < at[index - 1]);
    if (back !== -1) throw new Error(`WebSocket stub "atMs.${back}" is ${at[back]}, before the message ahead of it at ${at[back - 1]}; messages go in the order send lists them`);
    if (stub.close?.atMs !== undefined && at.length && stub.close.atMs < at.at(-1)) {
      throw new Error(`WebSocket stub "close.atMs" is ${stub.close.atMs}, before the last message at ${at.at(-1)}`);
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
   * The connection to whoever a routed document's connections go to, opened
   * for one client's: what the client sends is passed on once it opens, and
   * what comes back is passed to the client if the contract lets the mock
   * send it. A target that can't be reached, doesn't open within
   * `timeoutMs`, or ends without closing closes the client's with 1014.
   */
  function upstream(entry, url, offered, peer, served) {
    const target = entry.to ? entry.to.replace(/^http/, 'ws') : url;
    const timeoutMs = entry.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const queued = [];
    let done = false;
    let socket = null;
    let timer = null;
    const end = () => { done = true; clearTimeout(timer); };
    const fail = (reason) => {
      if (done) return;
      end();
      try { socket?.close(); } catch { /* already closing */ }
      peer.close(1014, reason);
    };
    try {
      const Socket = entry.handler ?? globalThis.WebSocket;
      socket = new Socket(target, offered);
    } catch (error) {
      queueMicrotask(() => fail(`Could not reach ${target}: ${error.message}`));
      return { send() {}, close() {} };
    }
    socket.binaryType = 'arraybuffer';
    timer = setTimeout(() => fail(`${target} did not open within ${timeoutMs}ms`), timeoutMs);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      for (const data of queued.splice(0)) socket.send(data);
    });
    socket.addEventListener('message', (event) => {
      if (done) return;
      const { message, reasons } = recognize(check, served.document.relativePath, served.channel.sends, event.data);
      if (!message) {
        end();
        socket.close();
        peer.close(1007, `${target} sent a message the contract doesn't let it send: ${reasons.join('; ')}`);
        return;
      }
      peer.send(event.data);
    });
    socket.addEventListener('close', (event) => {
      if (done) return;
      if (ABNORMAL.has(event.code)) {
        fail(`${target} closed without a close frame (${event.code})`);
        return;
      }
      end();
      peer.close(event.code === 1005 ? 1000 : event.code, event.reason ?? '');
    });
    return {
      send(data) {
        if (done) return;
        if (socket.readyState === 1) socket.send(data);
        else queued.push(data);
      },
      close(code, reason) {
        if (done) return;
        end();
        try { socket.close(closable(code), reason); } catch { /* already closing */ }
      },
    };
  }

  /**
   * Serve one connection: `url` is what the client connected to, `peer` the
   * far end, with `send(data)` and `close(code, reason)`, and `offered` the
   * subprotocols it asked for. Returns what to call with each frame that
   * arrives, and when the client closes.
   */
  function accept(url, peer, offered = []) {
    const path = new URL(url, 'ws://mock').pathname;
    const served = paths.get(decodeURIComponent(path));
    if (!served) {
      peer.close(1008, `The mock serves no WebSocket at ${path}`);
      return { message() {}, close() {} };
    }
    const { document, name: channelName, channel } = served;
    const entry = routed.get(document.api);
    let passed = null;
    // What stubs have still to send, each at its time. Once either side
    // closes, none of it is sent.
    const pending = new Set();
    let ended = false;
    const end = () => {
      ended = true;
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    };
    const after = (ms, then) => {
      if (!ms) { then(); return; }
      const timer = setTimeout(() => { pending.delete(timer); if (!ended) then(); }, ms);
      pending.add(timer);
    };
    // Closing the client's connection closes the one routed for it.
    const client = { send: (data) => peer.send(data), close: (code, reason) => { end(); passed?.close(1000); peer.close(code, reason); } };
    // A stub's messages in order, each at its time from now, then its close:
    // at its own time, or right after the last message. Each stub keeps its
    // own time, so two at once interleave.
    const play = (stub) => {
      const at = stub.atMs ?? [];
      for (const [index, reply] of (stub.send ?? []).entries()) after(at[index], () => client.send(JSON.stringify(reply)));
      // A dropped connection, or one refused, after what it sent.
      if (stub.close) after(stub.close.atMs ?? at.at(-1), () => client.close(stub.close.code, stub.close.reason ?? ''));
    };
    if (entry) passed = upstream(entry, url, offered, client, served);
    return {
      message(data) {
        const { message, reasons } = recognize(check, document.relativePath, channel.receives, data);
        if (!message) {
          client.close(1007, `Not a message the contract lets the mock receive: ${reasons.join('; ')}`);
          return;
        }
        const payload = isBinary(data) ? null : JSON.parse(data);
        const stub = takeStub(document, channelName, message, payload, offered);
        if (stub) {
          play(stub);
          return;
        }
        if (passed) {
          passed.send(data);
          return;
        }
        if (channel.replies.has(message.name)) {
          client.close(1011, `${message.name} is answered with ${channel.replies.get(message.name).map((m) => m.name).join(' or ')}, and no WebSocket stub gives one; register one at POST /mock/stubs/ws`);
        }
      },
      close(code, reason) {
        end();
        passed?.close(code, reason);
      },
    };
  }

  /**
   * A WebSocket, with the standard interface, connected in-process to the
   * mock: `new WebSocket('ws://localhost/communication/transcripts-relay')`.
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
        this._connection = accept(this.url, peer, [].concat(protocols));
        if (this.readyState !== MockWebSocket.CONNECTING) return;
        this.readyState = MockWebSocket.OPEN;
        fire('open');
      });
    }

    send(data) {
      if (this.readyState !== MockWebSocket.OPEN) throw new Error('The WebSocket is not open');
      this._connection.message(data);
    }

    close(code = 1000, reason = '') {
      if (this.readyState >= MockWebSocket.CLOSING) return;
      this.readyState = MockWebSocket.CLOSING;
      this._connection?.close(code, reason);
      queueMicrotask(() => this._closed(code, reason));
    }
  }

  return {
    WebSocket: MockWebSocket,
    accept,
    /** Whether the mock serves a WebSocket at this path. */
    serves: (path) => paths.has(decodeURIComponent(path)),
    /** Each API reached over its own connection that the mock serves: its document, and the paths it's served at. */
    sockets: () => new Map([...documents.values()].filter((d) => d.paths.length > 0).map((d) => [d.api, { relativePath: d.relativePath, paths: [...d.paths] }])),
    /** Send an API's connections to `entry.to` or `entry.handler` (routing.js). */
    route: (api, entry) => routed.set(api, entry),
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
