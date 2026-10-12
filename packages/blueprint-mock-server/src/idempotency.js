/**
 * The Idempotency-Key header, on operations that declare it.
 *
 * A client sends the same key with every retry of one request. The first is
 * handled; a repeat gets the stored response back instead of being handled
 * again; the same key with a different request is refused with 422. Keys are
 * scoped to the caller. This follows the IETF HTTP API working group's
 * Idempotency-Key draft, and the convention Stripe and others use.
 *
 * Only an operation that lists the header — the shared IdempotencyKeyParam —
 * is wrapped, so the contract decides where it applies. Keys are kept in the
 * store, so a reset clears them and a snapshot carries them, like any record.
 */

import { callerHeader } from './auth-context.js';

const COLLECTION = 'idempotency-keys';

/**
 * Whether an endpoint declares the Idempotency-Key header, and requires it.
 *
 * @param {{ parameters?: object[] }} endpoint
 * @returns {{ declared: boolean, required: boolean }}
 */
export function idempotencyOf(endpoint) {
  const param = (endpoint.parameters ?? []).find((p) =>
    p?.in === 'header' && typeof p.name === 'string' && p.name.toLowerCase() === 'idempotency-key');
  return { declared: Boolean(param), required: Boolean(param?.required) };
}

/** A request as text that is equal exactly when the requests are: method, path and body, with object keys in order. */
function fingerprintOf(method, pathname, body) {
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
    }
    return value;
  };
  return `${method} ${pathname} ${JSON.stringify(canonical(body))}`;
}

/**
 * Wrap a handler so it honors the header.
 *
 * @param {Function} handler - `(request, ctx) => Response`
 * @param {{ required: boolean }} options
 * @param {{ store: object }} deps
 * @returns {Function}
 */
export function withIdempotency(handler, { required }, { store }) {
  return async (request, ctx) => {
    const key = callerHeader(request, 'idempotency-key');
    if (!key) {
      if (!required) return handler(request, ctx);
      return Response.json({
        code: 'BAD_REQUEST',
        message: 'The Idempotency-Key header is required for this operation',
        details: [{ field: 'Idempotency-Key', message: 'required' }],
      }, { status: 400 });
    }

    let body = null;
    try { body = await request.clone().json(); } catch { body = null; }
    const { pathname } = new URL(request.url);
    const fingerprint = fingerprintOf(request.method, pathname, body);
    const id = `${callerHeader(request, 'x-caller-id') ?? ''}:${key}`;

    const stored = store.findById(COLLECTION, id);
    if (stored) {
      if (stored.fingerprint !== fingerprint) {
        return Response.json({
          code: 'UNPROCESSABLE_ENTITY',
          message: 'This Idempotency-Key was already used for a different request. A retry sends the same request with the same key; a new request needs a new key.',
        }, { status: 422 });
      }
      return new Response(stored.body, { status: stored.status, headers: stored.headers });
    }

    const response = await handler(request, ctx);
    // Only a request that was carried out is remembered. One refused before it
    // ran — invalid, or not allowed — can be corrected and sent again with the
    // same key.
    if (response.status >= 200 && response.status < 300) {
      const headers = {};
      for (const name of ['content-type', 'location']) {
        const value = response.headers.get(name);
        if (value) headers[name] = value;
      }
      const record = { id, fingerprint, status: response.status, headers, body: await response.clone().text() };
      if (typeof store.append === 'function') store.append(COLLECTION, record);
      else store.insertResource(COLLECTION, record);
    }
    return response;
  };
}
