/**
 * Helpers for testing Fetch-shaped handlers.
 *
 * Handlers are `(request, ctx) => Response` (#448), so a test builds a real
 * `Request` and reads a real `Response` rather than hand-rolling a mock
 * `req`/`res` pair. That removes a class of false pass: a mock `res` only
 * implements the methods the handler happens to call, so a handler that
 * started setting a header or streaming a body would still "pass".
 */

const ORIGIN = 'http://localhost:1080';

/**
 * Build a Request the way the adapter would.
 *
 * @param {string} path - Path with optional query string, e.g. '/tasks?limit=5'
 * @param {{ method?: string, body?: unknown, headers?: Record<string,string> }} [options]
 * @returns {Request}
 */
export function makeRequest(path, { method = 'GET', body, headers = {} } = {}) {
  const init = { method, headers: new Headers(headers) };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    if (!init.headers.has('content-type')) init.headers.set('content-type', 'application/json');
  }
  return new Request(`${ORIGIN}${path}`, init);
}

/**
 * Read a Response into the pieces assertions care about.
 *
 * @param {Response|Promise<Response>} response
 * @returns {Promise<{ status: number, body: unknown, headers: Headers }>}
 */
export async function readResponse(response) {
  const settled = await response;
  const text = await settled.text();
  let parsed = null;
  if (text !== '') {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }
  return { status: settled.status, body: parsed, headers: settled.headers };
}
