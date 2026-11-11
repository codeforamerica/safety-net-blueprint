/**
 * The token a relay checks: a short-lived JWT (RFC 7519, following RFC 8725)
 * the transcript audio adapter signs, naming the relay as its audience, and
 * the public keys it's checked with, published as a JSON Web Key Set
 * (RFC 7517). See communication-transcripts-relay-asyncapi.yaml, relayToken,
 * and communication-transcripts-audio-adapter-openapi.yaml,
 * getTranscriptConnectionKeys.
 *
 * Only ES256 (ECDSA with P-256 and SHA-256, RFC 7518): a token naming any
 * other algorithm is refused, which rules out choosing the algorithm from the
 * token, the usual JWT mistake. Written to the RFCs with Web Crypto rather
 * than taken from a JWT library, so the package carries no dependency; its
 * tests check it against jose. Runs in Node, a serverless function or a worker.
 */

const ALG = 'ES256';
const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGNING = { name: 'ECDSA', hash: 'SHA-256' };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const base64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64url = (text) => Uint8Array.from(
  atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4)),
  (c) => c.charCodeAt(0),
);
const encodeJson = (value) => base64url(encoder.encode(JSON.stringify(value)));
const decodeJson = (text) => JSON.parse(decoder.decode(fromBase64url(text)));

/** A token the relay won't take, with why, for its log. */
export class RelayTokenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RelayTokenError';
  }
}

/**
 * A new signing key, as a private JWK with its `kid`: keep it with the
 * adapter's other secrets. The public half is what the adapter publishes.
 *
 * @param {object} options
 * @param {string} options.kid - the key's id, which each token names
 * @returns {Promise<object>} a private JWK
 */
export async function generateRelayKey({ kid }) {
  if (!kid) throw new Error('generateRelayKey: give the key a kid');
  const { privateKey } = await crypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify']);
  return { ...await crypto.subtle.exportKey('jwk', privateKey), kid, alg: ALG, use: 'sig' };
}

/** The public half of a key, as a key set lists it. */
export function publicKeyOf({ kty, crv, x, y, kid }) {
  return { kty, crv, x, y, kid, alg: ALG, use: 'sig' };
}

/**
 * @param {object} options
 * @param {object} options.privateKey - a private JWK, from generateRelayKey
 * @param {string} options.audience - the relay's URL
 * @param {number} options.expiresIn - seconds
 * @param {Date} options.now
 * @returns {Promise<string>} a compact JWS
 */
export async function signRelayToken({ privateKey, audience, expiresIn, now }) {
  if (!privateKey?.d || !privateKey.kid) throw new Error('signRelayToken: give a private JWK with a kid');
  const key = await crypto.subtle.importKey('jwk', { ...privateKey, key_ops: ['sign'] }, ALGORITHM, false, ['sign']);
  const iat = Math.floor(now.getTime() / 1000);
  const input = `${encodeJson({ alg: ALG, typ: 'JWT', kid: privateKey.kid })}.${encodeJson({ aud: audience, iat, exp: iat + expiresIn })}`;
  // Web Crypto's ECDSA signature is r and s side by side, as JWS takes it (RFC 7518 §3.4).
  const signature = await crypto.subtle.sign(SIGNING, key, encoder.encode(input));
  return `${input}.${base64url(signature)}`;
}

/**
 * Check a token as a relay does: signed by one of the adapter's keys with
 * ES256, for this relay, and not expired.
 *
 * @param {string} token
 * @param {object} options
 * @param {{ keys: object[] } | (() => Promise<{ keys: object[] }>)} options.keys -
 *   the adapter's key set, or a function that gets it, from
 *   `GET /.well-known/jwks.json`, say; cache it, and get it again for a kid
 *   it doesn't have
 * @param {string} options.audience - this relay's URL
 * @param {Date} [options.now]
 * @param {number} [options.leeway] - seconds of clock difference allowed
 * @returns {Promise<object>} the token's claims
 * @throws {RelayTokenError}
 */
export async function verifyRelayToken(token, { keys, audience, now = new Date(), leeway = 30 }) {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) throw new RelayTokenError('Not a JWT');
  let header;
  let claims;
  try {
    header = decodeJson(parts[0]);
    claims = decodeJson(parts[1]);
  } catch {
    throw new RelayTokenError('The token isn\'t readable');
  }
  if (header.alg !== ALG) throw new RelayTokenError(`Signed with ${header.alg}, not ${ALG}`);

  const set = typeof keys === 'function' ? await keys() : keys;
  const jwk = set?.keys?.find((candidate) => candidate.kid === header.kid);
  if (!jwk) throw new RelayTokenError(`No key ${header.kid}`);
  const key = await crypto.subtle.importKey('jwk', publicKeyOf(jwk), ALGORITHM, false, ['verify']);
  const signed = await crypto.subtle.verify(SIGNING, key, fromBase64url(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`));
  if (!signed) throw new RelayTokenError('The signature doesn\'t match');

  const seconds = Math.floor(now.getTime() / 1000);
  const audiences = [].concat(claims.aud ?? []);
  if (!audiences.includes(audience)) throw new RelayTokenError(`Not for ${audience}`);
  if (typeof claims.exp !== 'number' || claims.exp + leeway <= seconds) throw new RelayTokenError('Expired');
  if (typeof claims.nbf === 'number' && claims.nbf - leeway > seconds) throw new RelayTokenError('Not valid yet');
  return claims;
}
