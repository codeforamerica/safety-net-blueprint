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
 * Extract auth context from an Express request.
 * @param {import('express').Request} req
 * @returns {{ userId: string, sub?: string, roles?: Array } | null}
 */
export function extractAuthContext(req) {
  // 1. X-Caller-Id header (mock/dev convention)
  const callerId = req.headers['x-caller-id'];
  if (callerId) {
    return { userId: callerId };
  }

  // 2. Bearer JWT
  const authHeader = req.headers['authorization'];
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
