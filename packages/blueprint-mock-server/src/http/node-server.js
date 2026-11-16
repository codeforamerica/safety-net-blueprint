/**
 * Serve a Fetch handler over `node:http`.
 *
 * This is the whole Node transport: an `IncomingMessage` becomes a `Request`,
 * the handler answers with a `Response`, and the `Response` is written back.
 * Nothing above this file knows what is carrying the request, which is what
 * lets the same route table be served by a service worker or called directly
 * in a browser (#448).
 *
 * The request body is the socket stream rather than a re-serialized copy, so a
 * multipart upload reaches `request.formData()` exactly as it arrived — and a
 * handler replaced by a real `fetch` can forward it unread.
 *
 * A WebSocket the contracts describe is the one thing that isn't a Fetch
 * request: its upgrade is accepted here, with `ws`, and the connection handed
 * to the mock's WebSockets (ws.js), which check and answer each message.
 */

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Headers mirroring the `cors` middleware this replaces.
 *
 * `Access-Control-Allow-Credentials: true` alongside a `*` origin is what the
 * previous configuration sent; browsers ignore the credentials flag when the
 * origin is a wildcard, so this is preserved as-is rather than quietly changed.
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-Caller-Id, X-Caller-Roles, Idempotency-Key, traceparent',
  'Access-Control-Allow-Credentials': 'true',
  // Response headers a page on another origin may read: where a create put
  // its record, and whether a response is an Idempotency-Key replay.
  'Access-Control-Expose-Headers': 'Location, Idempotent-Replayed',
};

/**
 * The preflight answer: every header the page asked to send is allowed.
 *
 * A fixed list refused anything not on it, and the browser then never sent
 * the request — so `includeHeaders: [X-API-Key]` could not work from a page,
 * and neither could `If-Match` or `Idempotency-Key`, which routing sends by
 * default. Allowing what was asked costs nothing here: the origin is already
 * `*`, so this is not a boundary the mock relies on, and what travels on to a
 * real service is decided by the routing rules, not by this.
 *
 * @param {import('node:http').IncomingMessage} req
 */
export function preflightHeaders(req) {
  const asked = req.headers['access-control-request-headers'];
  if (!asked) return CORS_HEADERS;
  return {
    ...CORS_HEADERS,
    'Access-Control-Allow-Headers': asked,
    // The answer depends on the question, so a cache must not reuse it for a
    // preflight that asked for something else.
    Vary: 'Access-Control-Request-Headers',
  };
}

/**
 * Build a Fetch `Request` from a Node request.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {Request}
 */
export function requestFromNode(req) {
  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.url, `http://${host}`);

  const controller = new AbortController();
  req.on('close', () => controller.abort());

  const init = { method: req.method, headers: req.headers, signal: controller.signal };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = Readable.toWeb(req);
    // Required when a body is a stream: the request is not full-duplex.
    init.duplex = 'half';
  }

  return new Request(url, init);
}

/**
 * Write a Fetch `Response` to a Node response.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {Response} response
 */
export async function writeToNode(res, response) {
  const headers = Object.fromEntries(response.headers);
  res.writeHead(response.status, { ...CORS_HEADERS, ...headers });

  if (!response.body) {
    res.end();
    return;
  }

  try {
    await pipeline(Readable.fromWeb(response.body), res);
  } catch (error) {
    // A client that disconnects mid-stream aborts the pipeline. That is the
    // normal end of an SSE subscription, not a failure worth reporting.
    if (error?.code !== 'ERR_STREAM_PREMATURE_CLOSE' && !res.destroyed) throw error;
  }
}

/**
 * A close reason a WebSocket can carry: at most 123 bytes (RFC 6455, 5.5),
 * cut at a character, with the whole of it logged.
 *
 * @param {string} reason
 */
function closeReason(reason = '') {
  const bytes = new TextEncoder().encode(reason);
  if (bytes.length <= 123) return reason;
  console.warn(`WebSocket closed: ${reason}`);
  let cut = new TextDecoder().decode(bytes.slice(0, 120));
  if (cut.endsWith('\uFFFD')) cut = cut.slice(0, -1);
  return `${cut}...`;
}

/**
 * Accept the WebSockets the mock serves on `server`, handing each connection
 * to `sockets.accept`. An upgrade to any other path is refused with 404.
 *
 * Answers with the first subprotocol the client offered: a relay's name, with
 * a token after it that is never sent back
 * (communication-transcripts-relay-asyncapi.yaml).
 *
 * @param {import('node:http').Server} server
 * @param {{ serves: (path: string) => boolean, accept: Function }} sockets - The mock's (ws.js)
 */
function acceptSockets(server, sockets) {
  const wss = new WebSocketServer({ noServer: true, handleProtocols: (protocols) => [...protocols][0] ?? false });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `ws://${req.headers.host ?? 'localhost'}`);
    if (!sockets.serves(url.pathname)) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    const offered = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map((p) => p.trim()).filter(Boolean);
    wss.handleUpgrade(req, socket, head, (client) => {
      const peer = {
        send: (data) => client.send(data),
        close: (code, reason) => client.close(code, closeReason(reason)),
      };
      const connection = sockets.accept(url.href, peer, offered);
      client.on('message', (data, isBinary) => connection.message(isBinary
        ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
        : data.toString()));
      client.on('close', (code, reason) => connection.close(code, reason.toString()));
    });
  });
}

/**
 * Create an HTTP server that serves a Fetch handler.
 *
 * @param {(request: Request) => Promise<Response>} handler - Usually `createDispatcher(routes)`
 * @param {object} [options]
 * @param {{ serves: Function, accept: Function }} [options.sockets] - The
 *   mock's WebSockets (ws.js), to accept connections to
 * @returns {import('node:http').Server}
 */
export function createNodeServer(handler, { sockets = null } = {}) {
  const server = createServer(async (req, res) => {
    // Preflight never reaches a route; the allowed methods and headers are a
    // property of the transport, not of any endpoint.
    if (req.method === 'OPTIONS') {
      res.writeHead(204, preflightHeaders(req));
      res.end();
      return;
    }

    try {
      await writeToNode(res, await handler(requestFromNode(req)));
    } catch (error) {
      console.error('Unhandled error:', error);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(500, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        details: [{ message: error.message }],
      }));
    }
  });
  if (sockets) acceptSockets(server, sockets);
  return server;
}
