/**
 * Serve a Fetch handler over `node:http`.
 *
 * This is the whole Node transport: an `IncomingMessage` becomes a `Request`,
 * the handler answers with a `Response`, and the `Response` is written back.
 * Nothing above this file knows what is carrying the request, which is what
 * lets the same route table be served by a service worker or called directly
 * in a browser (#448).
 *
 * The request body is the socket stream rather than a re-serialised copy, so a
 * multipart upload reaches `request.formData()` exactly as it arrived — and a
 * handler replaced by a real `fetch` can forward it unread.
 */

import { createServer } from 'node:http';
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
    'Content-Type, Authorization, X-Caller-Id, X-Caller-Roles, X-Mock-Now, traceparent',
  'Access-Control-Allow-Credentials': 'true',
};

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
 * Create an HTTP server that serves a Fetch handler.
 *
 * @param {(request: Request) => Promise<Response>} handler - Usually `createDispatcher(routes)`
 * @returns {import('node:http').Server}
 */
export function createNodeServer(handler) {
  return createServer(async (req, res) => {
    // Preflight never reaches a route; the allowed methods and headers are a
    // property of the transport, not of any endpoint.
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
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
}
