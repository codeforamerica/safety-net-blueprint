/**
 * The Node server checks a token against the environment's OpenID Connect
 * provider (verify-token.js): signed by one of its keys, by its issuer, not
 * expired. No token isn't its business.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { tokenVerifier } from '../../src/http/verify-token.js';

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const text = (value) => b64(new TextEncoder().encode(JSON.stringify(value)));

async function provider() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1', alg: 'ES256' };
  const fetch = async (url) => Response.json(url.endsWith('openid-configuration')
    ? { issuer: 'https://idp.example', jwks_uri: 'https://idp.example/keys' }
    : { keys: [jwk] });
  const sign = async (claims, kid = 'k1') => {
    const unsigned = `${text({ alg: 'ES256', kid })}.${text(claims)}`;
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(unsigned));
    return `${unsigned}.${b64(signature)}`;
  };
  return { fetch, sign };
}

const schemes = { bearerAuth: { type: 'openIdConnect', openIdConnectUrl: 'https://idp.example/.well-known/openid-configuration' } };
const withToken = (token) => new Request('http://localhost/x', { headers: token ? { Authorization: `Bearer ${token}` } : {} });

describe('tokenVerifier', () => {
  test('nothing to check without an OpenID Connect scheme', () => {
    assert.equal(tokenVerifier({ callerId: { type: 'apiKey', in: 'header', name: 'X-Caller-Id' } }), null);
  });

  test('a good token passes; a bad one says why', async () => {
    const { fetch, sign } = await provider();
    const verify = tokenVerifier(schemes, { fetch });
    const later = Math.floor(Date.now() / 1000) + 600;
    assert.equal(await verify(withToken(await sign({ iss: 'https://idp.example', sub: 'pat', exp: later }))), null);
    assert.equal(await verify(withToken(null)), null, 'no token is no business of this check');
    assert.match(await verify(withToken(await sign({ iss: 'https://elsewhere', exp: later }))), /from https:\/\/elsewhere/);
    assert.match(await verify(withToken(await sign({ iss: 'https://idp.example', exp: 1 }))), /expired/);
    assert.match(await verify(withToken(await sign({ iss: 'https://idp.example' }, 'k9'))), /no key/);
    const good = await sign({ iss: 'https://idp.example', sub: 'pat', exp: later });
    const [head, , signature] = good.split('.');
    assert.match(await verify(withToken(`${head}.${text({ iss: 'https://idp.example', sub: 'sam', exp: later })}.${signature}`)), /signature/);
    assert.match(await verify(withToken(`${text({ alg: 'none' })}.${text({})}.`)), /not RS256 or ES256/);
  });
});
