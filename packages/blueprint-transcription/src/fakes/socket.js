/**
 * A WebSocket to a fake relay in a worker, for a demo that runs the state's
 * side apart from the page. Nothing standard carries a WebSocket between a
 * page and its worker, so the connection goes over a MessagePort — from the
 * mock server's worker entry, `server.connect(name)` — and each end looks
 * like what code already expects:
 *
 * - in the page, a class with the standard WebSocket interface (`send`,
 *   `close`, `readyState`, `protocol`, `binaryType` and the open, message and
 *   close events), to hand the relay adapter as its `WebSocket`;
 * - in the worker, connections delivered by the two hooks the `ws` package
 *   names, `handleProtocols` and `handleConnection`, each socket with `send`,
 *   `close`, `readyState`, `protocol` and `on('message' | 'close')`, as `ws`
 *   gives it — the fake relay's own hooks fit as they are.
 *
 * A relay in the same page needs none of this: mock-socket's Server takes the
 * same two hooks (fakes/relay.js).
 *
 * Over the port each side sends `{ type, … }`: the page `open` with the
 * offered subprotocols, the worker `opened` with the one chosen, or
 * `refused`; then `message` with the data, and `close`, either way. Messages
 * arrive in order and asynchronously, as over a real connection, including
 * those sent just before a close.
 */

/** Binary data as an ArrayBuffer of its own, safe to transfer. */
const owned = (data) => (typeof data === 'string' ? data
  : ArrayBuffer.isView(data) ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    : data.slice(0));

function send(port, data) {
  const message = { type: 'message', data: owned(data) };
  port.postMessage(message, message.data instanceof ArrayBuffer ? [message.data] : []);
}

/**
 * The page's side: a WebSocket class whose connections are opened over the
 * port `connect` gives, such as `() => server.connect('relay')`.
 *
 * @param {() => MessagePort|Promise<MessagePort>} connect
 * @param {object} [options]
 * @param {(from: 'client'|'relay', data: string|ArrayBuffer) => void} [options.tap] - told of each message
 * @returns {typeof WebSocket}
 */
export function createWorkerWebSocket(connect, { tap = () => {} } = {}) {
  return class WorkerWebSocket extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url, protocols = []) {
      super();
      this.url = String(url);
      this.protocol = '';
      this.readyState = 0;
      this.binaryType = 'blob';
      Promise.resolve(connect()).then((port) => {
        this.port = port;
        port.onmessage = ({ data: message }) => {
          if (message.type === 'opened') {
            this.protocol = message.protocol;
            this.readyState = 1;
            this.dispatchEvent(new Event('open'));
          } else if (message.type === 'message' && this.readyState === 1) {
            tap('relay', message.data);
            this.dispatchEvent(new MessageEvent('message', { data: message.data }));
          } else if (message.type === 'refused' || message.type === 'close') {
            if (message.type === 'refused') this.dispatchEvent(new Event('error'));
            this.#closed();
          }
        };
        port.start?.();
        port.postMessage({ type: 'open', url: this.url, protocols: [].concat(protocols) });
      }, () => {
        this.dispatchEvent(new Event('error'));
        this.#closed();
      });
    }

    send(data) {
      if (this.readyState !== 1) return;
      tap('client', data);
      send(this.port, data);
    }

    close() {
      if (this.readyState >= 2) return;
      this.port?.postMessage({ type: 'close' });
      this.#closed();
    }

    #closed() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.port?.close();
      setTimeout(() => this.dispatchEvent(new Event('close')));
    }
  };
}

/**
 * The worker's side: take a connection the page opened over `port`, as a
 * `ws` server would take an upgrade.
 *
 * @param {MessagePort} port
 * @param {object} hooks
 * @param {(protocols: Set<string>) => string|false} [hooks.handleProtocols]
 *   the subprotocol to answer with, or false to refuse; the first offered when not given
 * @param {(socket: object) => void} hooks.handleConnection - each socket, once open
 */
export function serveWebSocketOverPort(port, { handleProtocols = (protocols) => [...protocols][0] ?? '', handleConnection }) {
  port.onmessage = ({ data: message }) => {
    if (message.type !== 'open') return;
    const protocol = handleProtocols(new Set(message.protocols));
    if (protocol === false) {
      port.postMessage({ type: 'refused' });
      port.close();
      return;
    }
    const listeners = { message: [], close: [] };
    const socket = {
      protocol,
      readyState: 1,
      send(data) { if (socket.readyState === 1) send(port, data); },
      close() {
        if (socket.readyState >= 2) return;
        port.postMessage({ type: 'close' });
        socket.closed();
      },
      closed() {
        if (socket.readyState === 3) return;
        socket.readyState = 3;
        port.close();
        for (const listener of listeners.close) listener();
      },
      on(event, listener) { listeners[event]?.push(listener); return socket; },
    };
    port.onmessage = ({ data: next }) => {
      if (next.type === 'message' && socket.readyState === 1) {
        // As ws gives it: the data, and whether it's binary.
        for (const listener of listeners.message) listener(next.data, typeof next.data !== 'string');
      } else if (next.type === 'close') {
        socket.closed();
      }
    };
    port.postMessage({ type: 'opened', protocol });
    handleConnection(socket);
  };
  port.start?.();
}
