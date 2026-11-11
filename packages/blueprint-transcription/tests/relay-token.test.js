/**
 * The relay's token and the adapter's key set, checked against jose
 * (devDependency only), the JavaScript library for JWTs and key sets: what we
 * sign, jose verifies with the key set the adapter publishes, and what jose
 * signs, we verify.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { jwtVerify, createLocalJWKSet, SignJWT, importJWK } from 'jose';
import {
  createTranscriptAudioAdapter, awsTranscribeIssuer, relayIssuer, generateRelayKey, verifyRelayToken, RelayTokenError,
} from '../src/server/index.js';
import { RELAY_PROTOCOL } from '../src/relay-protocol.js';

const RELAY = 'wss://relay.example/transcribe';
const NOW = new Date('2026-11-11T10:00:00Z');
const AUDIO = { encoding: 'linear16', sampleRateHertz: 16000, channelCount: 1 };
const ASKED = { provider: 'google-cloud-speech', languages: ['en-US'], audio: AUDIO, protocols: ['websocket'] };

const key = await generateRelayKey({ kid: 'relay-1' });
const adapter = createTranscriptAudioAdapter({
  issuers: { 'google-cloud-speech': relayIssuer({ url: RELAY, privateKey: key, now: () => NOW }) },
});
const issued = async (body = ASKED) => (await adapter(new Request('https://adapter.example/issue-connection', {
  method: 'POST', body: JSON.stringify(body),
}))).json();
const keySet = async () => (await adapter(new Request('https://adapter.example/.well-known/jwks.json'))).json();

test('issue-connection answers with the relay, its subprotocol and a token for it', async () => {
  const body = await issued({ ...ASKED, metadata: { transcriptId: 't-1' } });
  assert.deepStrictEqual(body.metadata, { transcriptId: 't-1' });
  assert.strictEqual(body.provider, 'google-cloud-speech');
  assert.strictEqual(body.protocol, 'websocket');
  assert.strictEqual(body.url, RELAY);
  assert.strictEqual(body.subprotocol, RELAY_PROTOCOL);
  assert.strictEqual(body.tokenType, 'Bearer');
  assert.strictEqual(body.expiresIn, 60);
  assert.deepStrictEqual(body.connectionParameters, { languages: ['en-US'] });
});

test('jose verifies the token with the key set the adapter publishes', async () => {
  const { accessToken } = await issued();
  const response = await adapter(new Request('https://adapter.example/.well-known/jwks.json'));
  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.headers.get('content-type'), 'application/jwk-set+json');
  const set = await response.json();
  assert.strictEqual(set.keys.length, 1);
  assert.strictEqual(set.keys[0].d, undefined, 'the private part is never published');
  const { payload, protectedHeader } = await jwtVerify(accessToken, createLocalJWKSet(set), {
    audience: RELAY, algorithms: ['ES256'], currentDate: NOW,
  });
  assert.strictEqual(protectedHeader.kid, 'relay-1');
  assert.strictEqual(payload.exp - payload.iat, 60);
});

test('a token jose signs, the relay\'s check takes', async () => {
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: 'relay-1' })
    .setAudience(RELAY).setIssuedAt(NOW).setExpirationTime(new Date(NOW.getTime() + 60_000))
    .sign(await importJWK(key, 'ES256'));
  const claims = await verifyRelayToken(token, { keys: await keySet(), audience: RELAY, now: NOW });
  assert.strictEqual(claims.aud, RELAY);
});

test('the relay\'s check takes the adapter\'s own token, and gets the key set when asked', async () => {
  const { accessToken } = await issued();
  let asked = 0;
  await verifyRelayToken(accessToken, { keys: async () => { asked += 1; return keySet(); }, audience: RELAY, now: NOW });
  assert.strictEqual(asked, 1);
});

const refused = async (token, options, why) => assert.rejects(
  verifyRelayToken(token, { keys: await keySet(), audience: RELAY, now: NOW, ...options }),
  (error) => error instanceof RelayTokenError && why.test(error.message),
);

test('the relay refuses a token that\'s expired, for another relay, or not one of the adapter\'s', async () => {
  const { accessToken } = await issued();
  await refused(accessToken, { now: new Date(NOW.getTime() + 91_000) }, /Expired/);
  await refused(accessToken, { audience: 'wss://other.example' }, /Not for/);
  const other = await generateRelayKey({ kid: 'relay-1' });
  const forged = await relayIssuer({ url: RELAY, privateKey: other, now: () => NOW })(ASKED);
  await refused(forged.accessToken, {}, /signature/);
  await refused('not.a.token', {}, /readable/);
});

test('the relay refuses a token signed with any algorithm but ES256', async () => {
  const secret = new TextEncoder().encode('a shared secret long enough for HS256!');
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256', kid: 'relay-1' })
    .setAudience(RELAY).setExpirationTime(new Date(NOW.getTime() + 60_000)).sign(secret);
  await refused(token, {}, /HS256/);
  const unsigned = `${btoa(JSON.stringify({ alg: 'none', kid: 'relay-1' }))}.${btoa(JSON.stringify({ aud: RELAY, exp: 9e9 }))}.`;
  await refused(unsigned, {}, /none/);
});

test('an adapter that signs for no relay has no key set', async () => {
  const plain = createTranscriptAudioAdapter({ issuers: { 'aws-transcribe': awsTranscribeIssuer({ region: 'us-east-1', credentials: {} }) } });
  const response = await plain(new Request('https://adapter.example/.well-known/jwks.json'));
  assert.strictEqual(response.status, 404);
});

test('a relay token lasts at most a minute', () => {
  assert.throws(() => relayIssuer({ url: RELAY, privateKey: key, expiresIn: 300 }), /60 seconds/);
});
