/**
 * A server in a worker: what answers requests — a mock, or anything with
 * `fetch`'s signature — run in a web worker, apart from the page, and used
 * from the page as if it were there.
 *
 *   // in the worker
 *   import { expose } from '@codeforamerica/blueprint-mock-server/worker';
 *   const mock = await createMockServer({ contracts });
 *   expose({ fetch: mock.fetch, connections: { relay: (port) => … } });
 *
 *   // in the page
 *   import { wrap } from '@codeforamerica/blueprint-mock-server/worker';
 *   const server = wrap(new Worker(url, { type: 'module' }));
 *   const response = await server.fetch('/communication/transcripts');
 *   const port = await server.connect('relay');
 *
 * A demo runs the state's side this way, so two mocks share nothing: a mock
 * keeps its event reactions per page or process.
 *
 * Comlink's `expose` and `wrap` underneath, as they're used for any worker,
 * with a transfer handler for the Response, whose body streams across. A
 * Request's body is read before it's sent, its signal goes as a port that
 * aborts it in the worker, and a connection is a MessagePort, both
 * transferred.
 */

import * as Comlink from 'comlink';

Comlink.transferHandlers.set('response', {
  canHandle: (value) => value instanceof Response,
  serialize: (response) => {
    const body = response.body;
    return [
      { status: response.status, statusText: response.statusText, headers: [...response.headers], body },
      body ? [body] : [],
    ];
  },
  deserialize: ({ status, statusText, headers, body }) => new Response(body, { status, statusText, headers }),
});

/**
 * Answer the page's requests, in the worker.
 *
 * @param {object} server
 * @param {(request: Request) => Promise<Response>|Response} server.fetch
 * @param {Record<string, (port: MessagePort) => void>} [server.connections]
 *   what the page may open a channel to, by name
 * @param {object} [endpoint] - the worker's global scope unless given
 */
export function expose({ fetch, connections = {} }, endpoint = globalThis) {
  Comlink.expose({
    async fetch({ url, method, headers, body, abort }) {
      const controller = new AbortController();
      if (abort) {
        abort.onmessage = () => controller.abort();
        abort.start?.();
        // A request that's never aborted leaves its port open; that mustn't
        // keep a Node process alive (a page doesn't mind).
        abort.unref?.();
      }
      return fetch(new Request(url, { method, headers, body, signal: controller.signal }));
    },
    connect(name) {
      const open = connections[name];
      if (!open) throw new Error(`This server has no connection named "${name}"`);
      const { port1, port2 } = new MessageChannel();
      open(port1);
      return Comlink.transfer(port2, [port2]);
    },
  }, endpoint);
}

/**
 * The page's side: a server whose `fetch` and `connect` reach the worker.
 *
 * @param {Worker|object} worker - a Worker, or any Comlink endpoint
 * @returns {{
 *   fetch: (input: Request|string|URL, init?: RequestInit) => Promise<Response>,
 *   connect: (name: string) => Promise<MessagePort>,
 *   close: () => void,
 * }}
 */
export function wrap(worker) {
  const remote = Comlink.wrap(worker);
  return {
    async fetch(input, init) {
      const request = input instanceof Request && !init ? input : new Request(input, init);
      const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();
      const transfers = body ? [body] : [];
      let abort;
      if (request.signal) {
        const { port1, port2 } = new MessageChannel();
        port1.unref?.();
        request.signal.addEventListener('abort', () => { port1.postMessage('abort'); port1.close(); }, { once: true });
        abort = port2;
        transfers.push(port2);
      }
      return remote.fetch(Comlink.transfer({
        url: request.url, method: request.method, headers: [...request.headers], body, abort,
      }, transfers));
    },
    connect: (name) => remote.connect(name),
    close() {
      remote[Comlink.releaseProxy]();
      worker.terminate?.();
      worker.close?.();
    },
  };
}
