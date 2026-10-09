/**
 * Domains and endpoints that reach a real service instead of the mock (#283).
 *
 * A handler and `fetch` have the same signature, so making an endpoint real
 * is replacing one function with another — `route-table.js` calls itself the
 * substitution point for exactly this. What is left is deciding *which*
 * routes, and reissuing the request to somewhere else.
 *
 * Forward, not bypass. Declining to handle a request is meaningless in Node,
 * where this process is what is listening on that port, and in a page it only
 * means anything if the caller already addressed the real service. Forwarding
 * also keeps the caller unchanged when a route is switched.
 *
 * Configuration arrives as data, never a file path, because this runs in a
 * browser as well as in Node. The CLI reads a file and passes the array; a
 * page passes it directly; a test passes a literal. Both are checked against
 * the same schema, so a bad array and a file with a typo fail the same way.
 */

import { assertValid, dotted } from './mock-schemas.js';
import { matchAndPopHttp } from './mock-stub-engine.js';
import schema from '../schemas/forwarding-schema.json' with { type: 'json' };

/**
 * Request headers that travel without being named.
 *
 * Only what describes the request itself: content negotiation, the
 * concurrency and retry headers `docs/conventions/http.yaml` defines, and W3C
 * trace context. Everything else is dropped unless `includeHeaders` names it.
 *
 * An allowlist rather than a list of credentials to strip, because the caller
 * addressed the mock and where the request goes afterwards is decided by
 * configuration it knows nothing about. A denylist has to anticipate every
 * name a credential can travel under — `Authorization`, `Cookie`, `X-API-Key`
 * and whatever a vendor invented — and the one it misses is handed to a new
 * recipient with no error to notice. Dropping one too many fails as a 401,
 * which is cheap and visible.
 */
const DEFAULT_REQUEST_HEADERS = new Set([
  'accept', 'accept-language', 'content-type',
  'idempotency-key', 'if-match', 'if-none-match',
  'traceparent', 'tracestate',
]);

/**
 * Response headers that do not travel unless named.
 *
 * `set-cookie` is the real service's session, and whatever called the mock
 * has no business holding it. A page never sees it anyway; Node would pass it
 * on.
 */
const WITHHELD_RESPONSE_HEADERS = new Set(['set-cookie']);

/**
 * Response headers that describe the bytes on the wire rather than the body
 * passed on. `fetch` has already decoded a compressed body, so passing on
 * `content-encoding: gzip` with it would have the caller decode it twice.
 */
const ENCODING_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding']);

/** Statuses that send the caller somewhere else. 304 is not one of them. */
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * A handler that reissues the request to `target`.
 *
 * @param {string} target - Absolute base URL of the real service
 * @param {object} [options]
 * @param {string[]} [options.includeHeaders] - Headers to pass along beyond the defaults
 * @param {number} [options.timeoutMs]
 * @returns {(request: Request) => Promise<Response>}
 */
export function forwardTo(target, { includeHeaders = [], timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const named = new Set(includeHeaders.map((name) => name.toLowerCase()));

  return async function forwarded(request) {
    const incoming = new URL(request.url);

    // A stub is a per-test override, and outranks the configuration the same
    // way it outranks normal mock handling.
    const httpStub = matchAndPopHttp(request.method, incoming.pathname);
    // Answered the way the mock's own handler for this method would answer
    // it, so a stub behaves the same whether or not its route is real.
    if (httpStub) {
      const isDelete = request.method.toUpperCase() === 'DELETE';
      const status = httpStub.response?.status ?? (isDelete ? 204 : 200);
      return status === 204 || (isDelete && !httpStub.response?.body)
        ? new Response(null, { status })
        : Response.json(httpStub.response?.body ?? {}, { status });
    }

    const base = new URL(target);
    // The target's own path is a prefix, not something the route replaces:
    // `https://host/api` plus `/intake/applications` is `/api/intake/applications`.
    const url = new URL(
      base.pathname.replace(/\/$/, '') + incoming.pathname + incoming.search,
      base,
    );

    const headers = new Headers();
    for (const [name, value] of request.headers) {
      if (DEFAULT_REQUEST_HEADERS.has(name) || named.has(name)) headers.set(name, value);
    }

    // Never followed. A redirect would send the request somewhere the
    // configuration does not name, and every target is meant to be declared.
    const init = { method: request.method, headers, redirect: 'manual' };
    // Buffered rather than streamed: a streaming request body needs
    // `duplex: 'half'`, which browsers have barely implemented. The response
    // body is passed back as a stream, so a long-lived one still works.
    if (!['GET', 'HEAD'].includes(request.method.toUpperCase())) {
      init.body = await request.arrayBuffer();
    }
    if (typeof AbortSignal?.timeout === 'function') init.signal = AbortSignal.timeout(timeoutMs);

    let response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      // A dead target is a fact about this deployment, not about the
      // contract, so it reads as a gateway failure rather than as the
      // endpoint being broken.
      if (error?.name === 'TimeoutError') {
        return Response.json({
          code: 'GATEWAY_TIMEOUT',
          message: `${url.origin} did not answer this route within ${timeoutMs}ms`,
        }, { status: 504 });
      }
      return Response.json({
        code: 'BAD_GATEWAY',
        message: `Could not reach ${url.origin} for this route: ${error.message}`,
      }, { status: 502 });
    }

    // A page sees a redirect only as an opaque response with status 0 and no
    // location, so passing it on would hand the caller an empty answer.
    if (response.type === 'opaqueredirect' || REDIRECTS.has(response.status)) {
      const location = response.headers.get('location');
      return Response.json({
        code: 'BAD_GATEWAY',
        message: `${url.origin} answered this route with a redirect`
          + (location ? ` to ${location}` : '')
          + ', which the mock does not follow. Point forwardTo at where the service actually answers.',
      }, { status: 502 });
    }

    const passed = new Headers();
    for (const [name, value] of response.headers) {
      if (ENCODING_HEADERS.has(name)) continue;
      // The real service's CORS policy is toward the mock, not toward whatever
      // called the mock, and passed on it would override the mock's own.
      if (name.startsWith('access-control-')) continue;
      if (WITHHELD_RESPONSE_HEADERS.has(name) && !named.has(name)) continue;
      passed.append(name, value);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: passed,
    });
  };
}

/** What an entry is called in an error: the thing it names, or its position. */
function entryName(entry, index) {
  if (typeof entry?.domain === 'string') return `Forwarded domain "${entry.domain}"`;
  if (typeof entry?.endpoint === 'string') return `Forwarded endpoint "${entry.endpoint}"`;
  return `Forwarding entry #${index + 1}`;
}

/** Throw every way `document` disagrees with the schema, naming each entry. */
function checkSchema(document) {
  const entries = Array.isArray(document?.forwarding) ? document.forwarding : [];
  assertValid(schema, document, (pointer) => {
    const [, index, rest = ''] = pointer.match(/^\/forwarding\/(\d+)(.*)$/) ?? [];
    if (index === undefined) {
      return [pointer === '' ? 'The forwarding configuration' : 'forwarding', ''];
    }
    return [entryName(entries[Number(index)], Number(index)), dotted(rest)];
  }, { oneOf: 'needs exactly one of "domain" or "endpoint"' });
}

/**
 * The entries a configuration file declares, once it has been checked.
 *
 * The file is the schema's whole document, so an empty file or a misspelled
 * top-level key fails here rather than loading as nothing to forward — which
 * would boot a server that looks configured and forwards nothing.
 *
 * @param {unknown} document - The parsed file
 * @returns {Array}
 */
export function forwardingFromDocument(document) {
  checkSchema(document);
  return document.forwarding;
}

/**
 * The routes a domain declares, leaving out the ones the mock serves itself.
 *
 * Each route is tagged with its domain as it is registered, from the contract
 * that declared it. The path is not a reliable guide: a contract may be served
 * from the root, and an intake state machine's `submit` is not in the OpenAPI
 * document at all.
 */
function routesOfDomain(routes, domain) {
  return [...routes].filter(([, entry]) => entry.domain === domain && !entry.mock).map(([key]) => key);
}

/**
 * Check configuration against the schema and against the routes that exist,
 * and resolve it to one target per route.
 *
 * Checks the schema cannot make: a domain or endpoint naming nothing is the
 * failure this repository keeps finding — a declaration nobody reads, which
 * looks configured and does nothing — so it fails at boot. The same name twice
 * would leave the second silently winning. And the mock's own routes, stubs
 * and reset among them, are not the contracts' to forward.
 *
 * @param {Array} forwarding
 * @param {Map<string, object>} routes
 * @returns {Map<string, object>} Route key → the entry that forwards it
 */
export function validateForwarding(forwarding, routes) {
  checkSchema({ forwarding });

  const seen = new Set();
  const byRoute = new Map();
  // Domains first, so an endpoint entry overrides its domain whatever order
  // the file lists them in.
  const ordered = [...forwarding].sort((a, b) => Number(Boolean(a.endpoint)) - Number(Boolean(b.endpoint)));

  for (const entry of ordered) {
    const name = entryName(entry);
    const id = entry.domain ? `domain ${entry.domain}` : `endpoint ${entry.endpoint}`;
    if (seen.has(id)) throw new Error(`${name} is configured more than once`);
    seen.add(id);

    if (entry.domain) {
      const keys = routesOfDomain(routes, entry.domain);
      if (keys.length === 0) {
        const known = [...new Set([...routes.values()].map((e) => e.domain).filter(Boolean))].sort();
        throw new Error(`${name} declares no routes. Domains the contracts declare: ${known.join(', ')}`);
      }
      for (const key of keys) byRoute.set(key, entry);
      continue;
    }

    const route = routes.get(entry.endpoint);
    if (!route) {
      throw new Error(`${name} matches no route. Only an endpoint the contracts declare can be forwarded.`);
    }
    if (route.mock) {
      throw new Error(`${name} is one the mock serves itself, not one the contracts declare`);
    }
    byRoute.set(entry.endpoint, entry);
  }
  return byRoute;
}

/**
 * Point the configured routes at their real targets.
 *
 * Mutates handlers on routes that already exist rather than adding any, so
 * registration order and first-write-wins are untouched.
 *
 * @param {Map<string, object>} routes
 * @param {Array} [forwarding]
 * @returns {string[]} The route keys that were switched
 */
export function applyForwarding(routes, forwarding = []) {
  const byRoute = validateForwarding(forwarding, routes);

  for (const [key, { to, includeHeaders, timeoutMs }] of byRoute) {
    routes.get(key).handler = forwardTo(to, { includeHeaders, timeoutMs });
  }
  return [...byRoute.keys()];
}
