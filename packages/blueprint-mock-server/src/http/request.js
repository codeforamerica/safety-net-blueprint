/**
 * Reading a `Request`.
 *
 * Handlers are `(request, ctx) => Response`, so what used to arrive pre-parsed
 * on an Express `req` — the JSON body, the query string — is read from the
 * `Request` here instead. Both helpers reproduce what Express presented, since
 * the handlers were written against that and a quiet change in either would
 * alter behavior without failing a test.
 */

/**
 * Read a JSON request body, defaulting to `{}`.
 *
 * Matches what the handlers saw under Express: `express.json()` left `req.body`
 * as `{}` for an empty body and rejected malformed JSON before the handler ran,
 * so `req.body || {}` never saw a parse error. Handlers that need to tell an
 * empty body from a malformed one check the parsed value themselves.
 *
 * @param {Request} request
 * @returns {Promise<object>}
 */
export async function jsonBody(request) {
  const { value } = await readJsonBody(request);
  return value ?? {};
}

/**
 * Read a JSON body, distinguishing "absent" from "malformed".
 *
 * `express.json()` made these two different outcomes: an empty body became
 * `{}` and reached the handler, while malformed JSON was rejected with a 400
 * before the handler ran. Handlers that validate their body need the same
 * distinction, so collapsing both to `{}` would turn a 400 into a 422.
 *
 * @param {Request} request
 * @returns {Promise<{ ok: boolean, value: object|null }>}
 */
export async function readJsonBody(request) {
  if (request.method === 'GET' || request.method === 'HEAD') return { ok: true, value: {} };
  const raw = await request.text();
  if (raw === '') return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, value: null };
  }
}

/**
 * Parse the query string the way `req.query` presented it.
 *
 * Express's default parser returns a string for a single occurrence and an
 * array for a repeated one, and handlers rely on that — so this reproduces it
 * rather than flattening, which would silently change filter behavior for a
 * repeated query parameter.
 *
 * @param {Request} request
 * @returns {Record<string, string|string[]>}
 */
export function queryOf(request) {
  const query = {};
  for (const [key, value] of new URL(request.url).searchParams) {
    if (key in query) {
      query[key] = Array.isArray(query[key]) ? [...query[key], value] : [query[key], value];
    } else {
      query[key] = value;
    }
  }
  return query;
}

/**
 * Guard a converted handler against being registered unwrapped.
 *
 * `createGetHandler` had two call sites and only one was wrapped; the symptom
 * was `TypeError: Invalid URL` from `new URL(request.url)`, because an Express
 * `req.url` is a relative path. That names the wrong problem. Handlers convert
 * one at a time and most have more than one registration site, so each one
 * says so directly instead. Goes away with the adapter at step 3.
 *
 * @param {unknown} request
 * @param {string} handlerName
 * @returns {Request}
 */
export function assertFetchShaped(request, handlerName) {
  if (request instanceof Request) return request;
  throw new TypeError(
    `${handlerName} is Fetch-shaped ((request, ctx) => Response) but was called with ` +
    `something else. Handlers receive a Request from the dispatcher.`
  );
}

/**
 * The response `express.json()`'s error handler used to produce.
 *
 * Malformed JSON was rejected before a handler ever ran, so every endpoint
 * answered a bad body the same way. With no middleware layer, handlers return
 * this themselves rather than each inventing a message.
 *
 * @returns {Response}
 */
export function invalidJson() {
  return Response.json({
    code: 'BAD_REQUEST',
    message: 'Invalid JSON in request body',
    details: [{ field: 'body', message: 'Unexpected token in JSON' }],
  }, { status: 400 });
}
