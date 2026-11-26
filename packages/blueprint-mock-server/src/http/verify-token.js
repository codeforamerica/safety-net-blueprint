/**
 * Checking a caller's token, as a real server does, for the mock run as a
 * server.
 *
 * When the environment signs callers in with OpenID Connect, its discovery
 * document names the provider's issuer and the keys it signs tokens with
 * (`jwks_uri`). A request that sends a bearer token is checked against them:
 * the signature, the issuer, and that it hasn't expired. One that fails is
 * answered 401, so a local server refuses a bad token the way a deployment
 * would. A request with no token goes on as before, identified the mock's way
 * (auth-context.js): the mock doesn't require signing in, it only refuses a
 * sign-in that's wrong.
 *
 * Only the Node server checks. The mock in a page doesn't: whoever runs the
 * page controls it, so a check there would protect nothing.
 *
 * RS256 and ES256, the algorithms OpenID Connect providers sign with, through
 * Web Crypto. The keys are fetched once and kept, and fetched again when a
 * token names one that isn't among them, as a provider rotating keys needs.
 */

const ALGORITHMS = {
  RS256: { import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, verify: { name: 'RSASSA-PKCS1-v1_5' } },
  ES256: { import: { name: 'ECDSA', namedCurve: 'P-256' }, verify: { name: 'ECDSA', hash: 'SHA-256' } },
};

const fromBase64url = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const json = (text) => JSON.parse(new TextDecoder().decode(fromBase64url(text)));

/**
 * A check for the environment's OpenID Connect scheme, or null when it has
 * none to check against.
 *
 * @param {Record<string, object>} schemes - The shared schemes, by name
 * @param {{ fetch?: typeof fetch, now?: () => number }} [options]
 * @returns {((request: Request) => Promise<string|null>) | null} Resolves to
 *   why the request's token was refused, or null when it has none or it's good
 */
export function tokenVerifier(schemes, { fetch = globalThis.fetch, now = () => Date.now() } = {}) {
  const oidc = Object.values(schemes ?? {}).find((scheme) => scheme?.type === 'openIdConnect' && scheme.openIdConnectUrl);
  if (!oidc) return null;
  let provider = null;
  const discover = async () => {
    if (!provider) {
      const discovery = await (await fetch(oidc.openIdConnectUrl)).json();
      provider = { issuer: discovery.issuer, jwksUri: discovery.jwks_uri, keys: null };
    }
    return provider;
  };
  const keysOf = async (fresh) => {
    const known = await discover();
    if (!known.keys || fresh) known.keys = (await (await fetch(known.jwksUri)).json()).keys ?? [];
    return known.keys;
  };

  return async (request) => {
    const header = request.headers.get('authorization');
    if (!header?.startsWith('Bearer ')) return null;
    const parts = header.slice(7).split('.');
    if (parts.length !== 3) return 'the token is not a JWT';
    let head; let claims;
    try { head = json(parts[0]); claims = json(parts[1]); } catch { return 'the token can\'t be read'; }
    const algorithm = ALGORITHMS[head.alg];
    if (!algorithm) return `the token is signed with ${head.alg ?? 'nothing'}, not RS256 or ES256`;
    let jwk = (await keysOf(false)).find((key) => key.kid === head.kid);
    if (!jwk) jwk = (await keysOf(true)).find((key) => key.kid === head.kid);
    if (!jwk) return `no key of the provider's is ${head.kid}`;
    const key = await crypto.subtle.importKey('jwk', jwk, algorithm.import, false, ['verify']);
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    if (!await crypto.subtle.verify(algorithm.verify, key, fromBase64url(parts[2]), signed)) return 'the token\'s signature doesn\'t verify';
    const { issuer } = await discover();
    if (issuer && claims.iss !== issuer) return `the token is from ${claims.iss}, not ${issuer}`;
    if (typeof claims.exp === 'number' && claims.exp * 1000 <= now()) return 'the token has expired';
    return null;
  };
}
