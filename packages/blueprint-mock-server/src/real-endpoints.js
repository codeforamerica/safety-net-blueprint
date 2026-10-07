/**
 * Routes that reach a real service instead of the mock (#283).
 *
 * A handler and `fetch` have the same signature, so making an endpoint real
 * is replacing one function with another — `route-table.js` calls itself the
 * substitution point for exactly this. What is left is deciding *which*
 * routes, and reissuing the request to somewhere else.
 *
 * Forward, not bypass. Declining to handle a request is meaningless in Node,
 * where this process is what is listening on that port, and in a page it only
 * means anything if the caller already addressed the real service. Forwarding
 * also keeps the caller unchanged when a route is switched, and leaves the
 * response passing back through here, which is where checking a real
 * implementation against its contract would later go.
 *
 * Configuration arrives as data, never a file path, because this runs in a
 * browser as well as in Node. The CLI reads a file and passes the array; a
 * page passes it directly; a test passes a literal.
 */

import { validate } from './validator.js';

/**
 * What a real service answered that its own contract does not allow.
 *
 * Kept rather than thrown. The response is passed through untouched, because
 * a mock is in no position to overrule a real service — but a state wiring up
 * an adapter wants to know its answers disagree with the schema the blueprint
 * declares, and wants to assert on that in CI rather than read a log.
 */
const findings = [];

/** Everything a forwarded route answered that its contract disallows. */
export function conformanceFindings() {
  return [...findings];
}

/** Forget them — between tests, or after a reseed. */
export function clearConformance() {
  findings.length = 0;
}

/**
 * Compare a forwarded response against the schema the contract declares.
 *
 * Only JSON, and only where a schema was declared: a stream cannot be read
 * twice without buffering it, and an undeclared status has nothing to
 * disagree with.
 */
async function checkResponse(match, response, declared) {
  if (!declared?.schema) return;
  if (!response.headers.get('content-type')?.includes('application/json')) return;

  let body;
  try {
    body = await response.clone().json();
  } catch {
    findings.push({
      match,
      status: response.status,
      problem: 'the body is not JSON, but the contract declares a JSON response',
    });
    return;
  }

  const { valid, errors } = validate(body, declared.schema, `real:${match}`, declared.source);
  if (valid) return;

  findings.push({
    match,
    status: response.status,
    problem: 'the response does not match the schema this endpoint declares',
    errors: errors.map((e) => ({ field: e.field ?? e.instancePath, message: e.message })),
  });
  console.warn(`  ! ${match} answered ${response.status} with a body its contract disallows`);
  for (const e of errors.slice(0, 5)) console.warn(`      ${e.field ?? e.instancePath} ${e.message}`);
}

/**
 * Headers that describe one hop and must not be copied onto the next.
 * `host` goes too — `fetch` sets it from the target URL.
 */
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host',
]);

/**
 * Credentials a caller sent to the mock, which do not travel by default.
 *
 * The caller addressed the mock; where that request goes afterwards is
 * decided by configuration it knows nothing about, and that target can change
 * without the caller or the user involved. Forwarding a bearer token by
 * default means a one-line config edit silently hands somebody's credential
 * to a new recipient — and possession is authorization. Failing as a 401 is
 * cheap and visible; leaking a token is neither.
 */
const CREDENTIAL_HEADERS = new Set(['authorization', 'cookie']);

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * A handler that reissues the request to `target`.
 *
 * @param {string} target - Absolute base URL of the real service
 * @param {object} [options]
 * @param {string[]} [options.forwardHeaders] - Credential headers to pass through anyway
 * @param {number} [options.timeoutMs]
 * @returns {(request: Request) => Promise<Response>}
 */
export function forwardTo(target, {
  forwardHeaders = [], timeoutMs = DEFAULT_TIMEOUT_MS, match = target, declared = null,
} = {}) {
  const allowed = new Set(forwardHeaders.map((name) => name.toLowerCase()));

  return async function forwarded(request) {
    const incoming = new URL(request.url);
    const base = new URL(target);
    // The target's own path is a prefix, not something the route replaces:
    // `https://host/api` plus `/intake/applications` is `/api/intake/applications`.
    const url = new URL(
      base.pathname.replace(/\/$/, '') + incoming.pathname + incoming.search,
      base,
    );

    const headers = new Headers(request.headers);
    for (const name of [...headers.keys()]) {
      const lower = name.toLowerCase();
      if (HOP_BY_HOP.has(lower)) headers.delete(name);
      if (CREDENTIAL_HEADERS.has(lower) && !allowed.has(lower)) headers.delete(name);
    }

    const init = { method: request.method, headers, redirect: 'manual' };
    // Buffered rather than streamed: a streaming request body needs
    // `duplex: 'half'`, which browsers have barely implemented. The response
    // is passed back untouched, so a long-lived stream coming the other way
    // still works.
    if (!['GET', 'HEAD'].includes(request.method.toUpperCase())) {
      init.body = await request.arrayBuffer();
    }
    if (typeof AbortSignal?.timeout === 'function') init.signal = AbortSignal.timeout(timeoutMs);

    try {
      const response = await fetch(url, init);
      // Checked, never corrected. What the real service said is what the
      // caller gets; the disagreement is recorded beside it.
      await checkResponse(match, response, declared);
      return response;
    } catch (error) {
      // A dead target is a fact about this deployment, not about the
      // contract, so it reads as a gateway failure rather than as the
      // endpoint being broken.
      return Response.json({
        code: 'BAD_GATEWAY',
        message: `Could not reach ${url.origin} for this route: ${error.message}`,
      }, { status: 502 });
    }
  };
}

/**
 * Check configuration against the routes that exist.
 *
 * A `match` naming no route is the failure this repository keeps finding: a
 * declaration nobody reads, which looks configured and does nothing. Only a
 * declared endpoint can be made real, so a typo is a boot failure.
 *
 * @param {Array} realEndpoints
 * @param {Map<string, object>} routes
 */
export function validateRealEndpoints(realEndpoints, routes) {
  if (!Array.isArray(realEndpoints)) {
    throw new Error('realEndpoints must be an array of { match, forwardTo }');
  }

  for (const entry of realEndpoints) {
    if (!entry?.match || typeof entry.match !== 'string') {
      throw new Error('Each real endpoint needs a "match" naming a route, e.g. "POST /intake/applications"');
    }
    if (!entry.forwardTo || typeof entry.forwardTo !== 'string') {
      throw new Error(`Real endpoint "${entry.match}" needs a "forwardTo" URL`);
    }
    try {
      new URL(entry.forwardTo);
    } catch {
      throw new Error(`Real endpoint "${entry.match}" has a "forwardTo" that is not an absolute URL: ${entry.forwardTo}`);
    }
    if (!routes.has(entry.match)) {
      throw new Error(
        `Real endpoint "${entry.match}" matches no route. `
        + 'Only an endpoint the contracts declare can be made real.',
      );
    }
    if (entry.forwardHeaders !== undefined && !Array.isArray(entry.forwardHeaders)) {
      throw new Error(`Real endpoint "${entry.match}" has a "forwardHeaders" that is not an array`);
    }
  }
}

/**
 * Route key → the response schema its contract declares.
 *
 * Built from the loaded specs rather than the route table, which holds
 * handlers and nothing about shapes. Without this a forwarded route is
 * unchecked, which is most of the value of forwarding rather than bypassing.
 *
 * @param {Array} apiSpecs - As `apiSpecsFromDocs` returns them
 * @param {(method: string, path: string) => string} routeKey
 * @param {(path: string) => string} templateOf
 */
export function responseSchemasByRoute(apiSpecs, routeKey, templateOf) {
  const byRoute = new Map();
  for (const spec of apiSpecs ?? []) {
    for (const endpoint of spec.endpoints ?? []) {
      if (!endpoint.responseSchema) continue;
      byRoute.set(routeKey(endpoint.method, templateOf(endpoint.path)), {
        schema: endpoint.responseSchema,
        source: { relativePath: spec.relativePath, ref: endpoint.responseSchemaRef },
      });
    }
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
 * @param {Array} [realEndpoints]
 * @returns {string[]} The route keys that were switched
 */
export function applyRealEndpoints(routes, realEndpoints = [], { responseSchemas } = {}) {
  if (realEndpoints.length === 0) return [];
  validateRealEndpoints(realEndpoints, routes);

  return realEndpoints.map(({ match, forwardTo: target, forwardHeaders, timeoutMs }) => {
    routes.get(match).handler = forwardTo(target, {
      forwardHeaders,
      timeoutMs,
      match,
      declared: responseSchemas?.get(match) ?? null,
    });
    return match;
  });
}
