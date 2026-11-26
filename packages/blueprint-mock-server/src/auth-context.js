/**
 * Who's calling the mock.
 *
 * The contract set says how callers sign in: the shared schemes in
 * base/components/security-schemes.yaml, as the environment has them, each
 * naming in `x-caller` where the caller's id, roles and anything else come
 * from. The mock reads each request the way those schemes say (callerReader)
 * before its handler runs (identify), and everything that asks who's calling
 * reads that: a token's claims for a bearer, OAuth or OpenID Connect scheme,
 * a header for one in a header. It never checks a token's signature: the mock
 * protects nothing, and in a page, whoever runs it controls it. A request no
 * scheme identifies falls back to the X-Caller-Id and X-Caller-Roles headers,
 * the framework's default, so a scenario or a test that sends them works
 * whatever the environment's scheme.
 */

/**
 * Read one header from either request shape.
 *
 * Handlers are being converted to Fetch `Request`, whose `headers` is a
 * `Headers` instance, while unconverted ones still pass an Express request,
 * whose `headers` is a lowercase-keyed plain object. This reads both so the
 * conversion can proceed a handler at a time (#448). It collapses to
 * `headers.get` once every caller is converted.
 *
 * @param {{ headers?: Headers|Record<string,string> }} req
 * @param {string} name - Lowercase header name
 * @returns {string|undefined}
 */
function headerOf(req, name) {
  const headers = req?.headers;
  if (!headers) return undefined;
  return typeof headers.get === 'function' ? (headers.get(name) ?? undefined) : headers[name];
}

/**
 * Extract auth context from a request.
 * @param {{ headers?: Headers|Record<string,string> }} req
 * @returns {{ userId: string, sub?: string, roles?: Array } | null}
 */
export function extractAuthContext(req) {
  const known = identified.get(req);
  if (known?.id) return { userId: known.id, roles: known.roles };

  // 1. X-Caller-Id header (mock/dev convention)
  const callerId = headerOf(req, 'x-caller-id');
  if (callerId) {
    return { userId: callerId };
  }

  // 2. Bearer JWT
  const authHeader = headerOf(req, 'authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const payload = decodeJwtPayload(token);
      if (payload.userId) {
        return {
          userId: payload.userId,
          sub: payload.sub,
          roles: payload.roles
        };
      }
    } catch {
      // Malformed token — fall through and return null
    }
  }

  return null;
}

/**
 * Extract the caller's roles from the X-Caller-Roles request header.
 * @param {{ headers?: Headers|Record<string,string> }} req
 * @returns {string[]}
 */
export function extractCallerRoles(req) {
  if (systemRequests.has(req)) return systemRoles();
  const known = identified.get(req);
  if (known?.roles) return known.roles;
  const header = headerOf(req, 'x-caller-roles');
  return header ? header.split(',').map(r => r.trim()).filter(Boolean) : [];
}

// Requests the mock sends itself as the system — an operation call a state
// machine makes with `runAs: system` — and the roles read from them. Kept
// beside the request rather than in a header, so no client can claim it: a
// client sending `X-Caller-Roles: system` is a caller with a role named system.
const systemRequests = new WeakSet();
const systemRoleLists = new WeakSet();

/** The role the system plays, as a contract's guards name it in actors. */
const SYSTEM_ROLE = 'system';

/** The roles of the system: `['system']`, marked as the system's. */
function systemRoles() {
  const roles = [SYSTEM_ROLE];
  systemRoleLists.add(roles);
  return roles;
}

/** The system as a caller: a machine reacting to an event acts as it. */
export function theSystem() {
  return { id: 'system', roles: systemRoles() };
}

/**
 * Mark a request the mock sends itself as made by the system.
 *
 * @param {Request} req
 * @returns {Request} The same request
 */
export function asSystem(req) {
  systemRequests.add(req);
  return req;
}

/**
 * Whether roles are a list of the actors allowed: the system's always are,
 * since a system call skips role matching — its guards' conditions, and every
 * other check, still apply. No actors means anyone.
 *
 * @param {string[]} roles - As extractCallerRoles gave them
 * @param {string[]} actors
 * @returns {boolean}
 */
export function playsAnyOf(roles, actors) {
  if (!actors || actors.length === 0) return true;
  if (systemRoleLists.has(roles)) return true;
  return (roles ?? []).some((r) => actors.includes(r));
}

/**
 * Whether roles are the system's, read from a request marked by asSystem.
 *
 * @param {string[]} roles
 * @returns {boolean}
 */
export function areSystemRoles(roles) {
  return systemRoleLists.has(roles);
}

/**
 * Read a header from either request shape, for callers that want one directly.
 * @param {{ headers?: Headers|Record<string,string> }} req
 * @param {string} name - Lowercase header name
 * @returns {string|null}
 */
export function callerHeader(req, name) {
  if (name === 'x-caller-id' && identified.get(req)?.id) return identified.get(req).id;
  return headerOf(req, name) ?? null;
}

/**
 * The caller as `$caller` has them: their id, their roles, and whatever else
 * the scheme's `x-caller` names, such as the counties a state adds.
 *
 * @param {{ headers?: Headers|Record<string,string> }} req
 * @returns {{ id: string|null, roles: string[] } & Record<string, unknown>}
 */
export function callerOf(req) {
  const known = identified.get(req);
  return { ...(known ?? {}), id: callerHeader(req, 'x-caller-id'), roles: extractCallerRoles(req) };
}

// The caller each request was identified as (identify), kept beside the
// request, so no handler reads a header the scheme doesn't name.
const identified = new WeakMap();

/**
 * The same sender for a request rebuilt from another, as the route table
 * rebuilds one at a path without the site's prefix: who it's from, whether
 * the system sent it, and what caused it.
 *
 * @param {Request} from
 * @param {Request} to
 * @returns {Request} `to`
 */
export function sameSender(from, to) {
  if (identified.has(from)) identified.set(to, identified.get(from));
  if (systemRequests.has(from)) systemRequests.add(to);
  if (causes.has(from)) causes.set(to, causes.get(from));
  return to;
}

/**
 * Remember who a request is from, as callerReader read it.
 *
 * @param {Request} req
 * @param {object|null} caller
 * @returns {Request} The same request
 */
export function identify(req, caller) {
  if (caller) identified.set(req, caller);
  return req;
}

/** A field's value as a list: a claim may be a list, or a comma-separated string. */
const listOf = (value) => (Array.isArray(value) ? value.map(String)
  : typeof value === 'string' ? value.split(',').map((v) => v.trim()).filter(Boolean)
    : value == null ? undefined : [String(value)]);

/**
 * How to read a request's caller, from the environment's shared schemes:
 * the first that identifies the request wins. A scheme in a header gives the
 * id as that header's value, and its `x-caller` names the headers for the
 * rest; a bearer, OAuth 2.0 or OpenID Connect scheme reads the token's claims
 * `x-caller` names (`sub` and `roles` when it names none). A cookie is the
 * server's own session, which the mock can't look up, so it identifies no
 * one.
 *
 * @param {Record<string, object>} schemes - The shared schemes, by name
 * @returns {(req: Request) => (Record<string, unknown> & { id: string, roles?: string[] }) | null}
 */
export function callerReader(schemes) {
  const readers = Object.values(schemes ?? {}).filter((scheme) => scheme && typeof scheme === 'object').map((scheme) => {
    const fields = scheme['x-caller'] ?? {};
    if (scheme.type === 'apiKey' && scheme.in === 'header' && scheme.name) {
      return (req) => {
        const id = headerOf(req, String(scheme.name).toLowerCase());
        if (!id) return null;
        const caller = { id };
        for (const [field, header] of Object.entries(fields)) {
          if (field === 'id') continue;
          const value = headerOf(req, String(header).toLowerCase());
          if (value !== undefined) caller[field] = field === 'roles' ? listOf(value) : value;
        }
        return caller;
      };
    }
    const bearer = (scheme.type === 'http' && String(scheme.scheme).toLowerCase() === 'bearer')
      || scheme.type === 'oauth2' || scheme.type === 'openIdConnect';
    if (!bearer) return null;
    return (req) => {
      const header = headerOf(req, 'authorization');
      if (!header?.startsWith('Bearer ')) return null;
      let claims;
      try { claims = decodeJwtPayload(header.slice(7)); } catch { return null; }
      const named = { id: 'sub', roles: 'roles', ...fields };
      const id = claims[named.id];
      if (id == null) return null;
      const caller = { id: String(id) };
      for (const [field, claim] of Object.entries(named)) {
        if (field === 'id' || claims[claim] === undefined) continue;
        caller[field] = field === 'roles' ? listOf(claims[claim]) : claims[claim];
      }
      return caller;
    };
  }).filter(Boolean);
  return (req) => {
    for (const read of readers) {
      const caller = read(req);
      if (caller) return caller;
    }
    return null;
  };
}

// The event that caused a request the mock sends itself — an action calling an
// operation as the caller — so the operation's events name it as their cause.
// Kept beside the request rather than in a header, so no client can set it.
const causes = new WeakMap();

/**
 * Mark a request the mock sends itself as caused by an event.
 *
 * @param {Request} req
 * @param {string|null} causationid - The causing event's id
 * @returns {Request} The same request
 */
export function causedBy(req, causationid) {
  if (causationid) causes.set(req, causationid);
  return req;
}

/**
 * The event that caused a request, when the mock sent it itself; null for a
 * client's.
 *
 * @param {Request} req
 * @returns {string|null}
 */
export function causationOf(req) {
  return causes.get(req) ?? null;
}

// The trace each request started, so every event one request causes shares it.
const startedTraces = new WeakMap();

/**
 * The W3C trace context a request's events carry: the caller's `traceparent`
 * when it sent one, otherwise a trace this request starts — as the first
 * service a request reaches does. Asking twice for one request gives the same
 * trace.
 *
 * @param {{ headers?: Headers|Record<string,string> }} req
 * @returns {string}
 */
export function traceparentOf(req) {
  const sent = headerOf(req, 'traceparent');
  if (sent) return sent;
  if (!startedTraces.has(req)) {
    startedTraces.set(req, `00-${randomHex(16)}-${randomHex(8)}-01`);
  }
  return startedTraces.get(req);
}

function randomHex(bytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Decode a JWT payload without verifying the signature.
 * @param {string} token
 * @returns {Object} Parsed payload
 */
function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  // base64url → base64 → text, with atob, which a page and Node both have
  const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}
