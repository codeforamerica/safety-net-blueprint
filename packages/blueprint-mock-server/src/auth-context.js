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
  const header = headerOf(req, 'x-caller-roles');
  return header ? header.split(',').map(r => r.trim()).filter(Boolean) : [];
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
