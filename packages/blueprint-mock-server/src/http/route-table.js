/**
 * The route table, and dispatching a request against it.
 *
 * A route table is a `Map` from `'METHOD /path'` to an entry holding the
 * handler. Paths use OpenAPI's `{param}` syntax, matching the contract rather
 * than any framework's convention — `:param` would leak Express, which #448's
 * step 3 removes.
 *
 * The table is the substitution point for #283: making an endpoint real is
 * assigning a different function to `entry.handler`. That works without an
 * adapter because a handler and `fetch` have the same signature — `fetch`
 * simply ignores the second argument.
 */

/**
 * The key a route is stored under.
 *
 * @param {string} method - HTTP method, any case
 * @param {string} path - Path template, e.g. '/applications/{applicationId}'
 * @returns {string}
 */
export function routeKey(method, path) {
  return `${method.toUpperCase()} ${path}`;
}

/**
 * Convert an Express-style path to the `{param}` template the table is keyed by.
 *
 * @param {string} expressPath - e.g. '/applications/:applicationId'
 * @returns {string} e.g. '/applications/{applicationId}'
 */
export function templateOf(expressPath) {
  return expressPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/**
 * Add a route, keeping the first registration for a key.
 *
 * **First registration wins**, which is what Express did. That is not an
 * incidental detail: composition routes are registered before the standard
 * ones precisely so their `sectionView` handlers take priority over the
 * sub-resource handlers generated for the same paths (`cli/server.js:343`).
 * A plain `Map.set` would invert that silently, since the later write would
 * replace the earlier one.
 *
 * @param {Map<string, object>} routes
 * @param {string} method
 * @param {string} expressPath - Path in either `:param` or `{param}` form
 * @param {Function} handler - Fetch-shaped handler
 * @param {{ operationId?: string, description?: string }} [meta]
 * @returns {boolean} Whether the route was added
 */
export function addRoute(routes, method, expressPath, handler, meta = {}) {
  const key = routeKey(method, templateOf(expressPath));
  if (routes.has(key)) return false;
  routes.set(key, {
    operationId: meta.operationId ?? null,
    description: meta.description ?? null,
    expressPath,
    handler,
  });
  return true;
}

/**
 * Split a path into segments, ignoring leading and trailing slashes.
 *
 * @param {string} path
 * @returns {string[]}
 */
function segmentsOf(path) {
  return path.split('/').filter(Boolean);
}

/**
 * Match a concrete path against a path template.
 *
 * @param {string} template - e.g. '/applications/{applicationId}/documents'
 * @param {string} pathname - e.g. '/applications/app-1/documents'
 * @returns {Record<string,string>|null} Captured params, or null if no match
 */
export function matchPath(template, pathname) {
  const wanted = segmentsOf(template);
  const actual = segmentsOf(pathname);
  if (wanted.length !== actual.length) return null;

  const params = {};
  for (let i = 0; i < wanted.length; i++) {
    const segment = wanted[i];
    if (segment.startsWith('{') && segment.endsWith('}')) {
      // A path parameter never spans a segment, so an empty capture is a
      // non-match rather than a param with an empty value. `.` and `..` are
      // rejected for the same reason Express rejects them — they are path
      // navigation, not identifiers, and capturing `..` as a resource id
      // would hand a traversal-shaped string to the store.
      if (actual[i] === '' || actual[i] === '.' || actual[i] === '..') return null;
      params[segment.slice(1, -1)] = decodeURIComponent(actual[i]);
      continue;
    }
    if (segment !== actual[i]) return null;
  }
  return params;
}

/**
 * Find the route that serves a request.
 *
 * **First registered wins**, matching Express, because this codebase depends on
 * it in both directions. A composition's `review/{section}` panel is registered
 * before the generated literal `review/identity` routes so the panel serves
 * them; the SSE stream is registered before the item routes so `{id}` does not
 * capture `/events/stream`.
 *
 * Preferring a literal segment over a parameter reads as the tidier rule and is
 * what this function did first — it silently sent every composition panel to
 * the generated route instead, and only the end-to-end suite noticed. Ordering
 * is a semantic callers already rely on, so it is reproduced rather than
 * improved on.
 *
 * @param {Map<string, object>} routes
 * @param {string} method
 * @param {string} pathname
 * @returns {{ key: string, entry: object, params: Record<string,string> }|null}
 */
export function matchRoute(routes, method, pathname) {
  const prefix = `${method.toUpperCase()} `;

  for (const [key, entry] of routes) {
    if (!key.startsWith(prefix)) continue;
    const params = matchPath(key.slice(prefix.length), pathname);
    if (params !== null) return { key, entry, params };
  }

  return null;
}

/**
 * Build the `fetch` function that serves a route table.
 *
 * This owns the generic failure modes — no matching route, and a handler that
 * throws instead of returning a Response. Handlers keep only the catches that
 * mean something specific (search degrading to an empty result, create mapping
 * a unique-constraint violation to 409); everything else belongs here, so that
 * there is one answer rather than one per handler.
 *
 * @param {Map<string, object>} routes
 * @returns {(request: Request) => Promise<Response>} Same signature as `fetch`
 */
export function createDispatcher(routes, { basePath = '' } = {}) {
  // A prefix the route table knows nothing about, stripped before matching.
  // A page served from a subdirectory — GitHub Pages puts a project site at
  // /<repo>/ — resolves `/intake/applications` to `/<repo>/intake/applications`,
  // and the route table is keyed on the contract's own paths. Without this the
  // hosted page 404s every request while the same page works locally, which is
  // the worst shape for a bug to take (#448).
  const prefix = basePath.replace(/\/+$/, '');

  return async function fetch(request) {
    const { pathname } = new URL(request.url);
    const routable = prefix && pathname.startsWith(prefix)
      ? pathname.slice(prefix.length) || '/'
      : pathname;

    // Strip once, here, and hand the handler a request that has never heard of
    // the prefix. Matching the route on a stripped path while handlers read the
    // original left the two disagreeing: a handler consults the HTTP stub table
    // with `new URL(request.url).pathname`, so a stub registered for
    // `/determinations` never matched a request for `/repo/mock/determinations`
    // — the route resolved and the stub silently did not.
    const forwarded = routable === pathname ? request : withPathname(request, routable);
    const match = matchRoute(routes, request.method, routable);

    if (match === null) {
      return Response.json({
        code: 'NOT_FOUND',
        message: 'The requested endpoint does not exist',
      }, { status: 404 });
    }

    try {
      return await match.entry.handler(forwarded, { params: match.params });
    } catch (error) {
      console.error(`Unhandled error in ${match.key}:`, error);
      return Response.json({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        details: [{ message: error.message }],
      }, { status: 500 });
    }
  };
}


/**
 * The same request at a different path.
 *
 * Rebuilt rather than mutated, because a `Request`'s url is read-only. The
 * body is passed through as a stream with `duplex: 'half'` instead of being
 * buffered, so an upload stays an upload — reading it here would consume it
 * before the handler saw it.
 *
 * @param {Request} request
 * @param {string} pathname
 * @returns {Request}
 */
function withPathname(request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;

  const init = { method: request.method, headers: request.headers, signal: request.signal };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
    init.duplex = 'half';
  }
  return new Request(url, init);
}

/**
 * Replace a route's handler with one wrapping the original.
 *
 * The composition point for behavior that used to be middleware. Middleware
 * matched a path prefix and ran for anything under it; this names one route, so
 * it cannot quietly apply to a route added later.
 *
 * @param {Map<string, object>} routes
 * @param {string} key - e.g. 'POST /data-exchange/service-calls'
 * @param {(next: Function) => Function} wrap - Receives the current handler
 * @returns {boolean} Whether the route existed
 */
export function wrapRoute(routes, key, wrap) {
  const entry = routes.get(key);
  if (!entry) {
    console.warn(`wrapRoute: no route registered for "${key}" — wrapper not applied`);
    return false;
  }
  entry.handler = wrap(entry.handler);
  return true;
}

/**
 * Replace the handlers of contract-declared routes, matched by `operationId`.
 *
 * A few endpoints are declared in a contract but cannot be served by generated
 * CRUD: `streamEvents` is a stream, `publishEvent` fires the event bus rather
 * than storing a row. They are overrides rather than extra registrations, so
 * adding a platform endpoint to the contract needs no code — only an endpoint
 * whose *behavior* is special does.
 *
 * Matching on `operationId` rather than a path string is the point. A path can
 * be changed in the contract; the operationId is its identity, so renaming the
 * path moves the override with it.
 *
 * An unmatched override warns rather than throws: a contract set that declares
 * no platform domain is legitimate — the functional fixtures are one — so a
 * missing operationId cannot be told apart from a smaller set at this level.
 * Drift against the real contract set is caught by a test instead.
 *
 * @param {Map<string, object>} routes
 * @param {Record<string, Function>} overrides - operationId → handler
 * @returns {{ applied: string[], unmatched: string[] }}
 */
export function overrideByOperationId(routes, overrides) {
  const byOperationId = new Map();
  for (const [key, entry] of routes) {
    if (entry.operationId) byOperationId.set(entry.operationId, key);
  }

  const applied = [];
  const unmatched = [];
  for (const [operationId, handler] of Object.entries(overrides)) {
    const key = byOperationId.get(operationId);
    if (key === undefined) {
      unmatched.push(operationId);
      continue;
    }
    routes.get(key).handler = handler;
    applied.push(key);
  }

  return { applied, unmatched };
}
