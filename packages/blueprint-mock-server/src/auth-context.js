/**
 * Auth context extraction for the mock server.
 *
 * Resolves the caller's identity from the request using these sources, in order:
 *   1. X-Caller-Id header — explicit mock/dev convention
 *   2. Bearer JWT — decodes the payload (no signature verification) and reads
 *      the `userId` claim (User Service UUID)
 *
 * Returns null when no recognizable auth context is present.
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
 * @param {import('express').Request|Request} req
 * @returns {{ userId: string, sub?: string, roles?: Array } | null}
 */
export function extractAuthContext(req) {
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
 * @param {import('express').Request|Request} req
 * @returns {string[]}
 */
export function extractCallerRoles(req) {
  if (systemRequests.has(req)) return systemRoles();
  const header = headerOf(req, 'x-caller-roles');
  return header ? header.split(',').map(r => r.trim()).filter(Boolean) : [];
}

// Requests the mock sends itself as the system — an operation call a state
// machine makes with `runAs: system` — and the roles read from them. Kept
// beside the request rather than in a header, so no client can claim it: a
// client sending `X-Caller-Roles: system` is a caller with a role named system.
const systemRequests = new WeakSet();
const systemRoleLists = new WeakSet();

/** The roles of the system: `['system']`, marked as the system's. */
function systemRoles() {
  const roles = ['system'];
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
 * @param {import('express').Request|Request} req
 * @param {string} name - Lowercase header name
 * @returns {string|null}
 */
export function callerHeader(req, name) {
  return headerOf(req, name) ?? null;
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
 * @param {import('express').Request|Request} req
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
  // base64url → base64 → buffer → string
  const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
}
