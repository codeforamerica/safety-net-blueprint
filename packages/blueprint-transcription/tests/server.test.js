/**
 * The server adapter, with no AWS account: signing is computed locally, so a
 * URL signed with a made-up key is checked against what AWS's own signer
 * (devDependency only) computes for the same key. AWS checks a real URL the
 * same way, with the real key.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { createTranscriptsAdapter, awsTranscribeIssuer } from '../src/server/index.js';
import { presignUrl } from '../src/server/issuers/aws/sigv4.js';

// AWS's documented example key, not a real one.
const CREDENTIALS = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' };
const NOW = new Date('2026-10-12T10:00:00Z');
const HOST = 'transcribestreaming.us-east-1.amazonaws.com';
const AUDIO = { encoding: 'linear16', sampleRateHertz: 16000, channelCount: 1 };

const awsPresign = async (query, credentials = CREDENTIALS) => {
  const signer = new SignatureV4({ service: 'transcribe', region: 'us-east-1', credentials, sha256: Sha256 });
  const signed = await signer.presign({
    method: 'GET', protocol: 'wss:', hostname: HOST, port: 8443, path: '/stream-transcription-websocket',
    query, headers: { host: `${HOST}:8443` },
  }, { expiresIn: 300, signingDate: NOW });
  return signed.query;
};
const paramsOf = (url) => Object.fromEntries(new URL(url).searchParams);

for (const [name, credentials] of [
  ['a key', CREDENTIALS],
  ['a key with a session token', { ...CREDENTIALS, sessionToken: 'session/token+with=odd chars' }],
]) {
  test(`the signature matches AWS's signer, for ${name}`, async () => {
    const query = { 'language-code': 'en-US', 'media-encoding': 'pcm', 'sample-rate': '16000', 'vocabulary-name': 'benefits terms' };
    const ours = await presignUrl({
      protocol: 'wss:', host: `${HOST}:8443`, path: '/stream-transcription-websocket', query,
      service: 'transcribe', region: 'us-east-1', credentials, expiresIn: 300, now: NOW,
    });
    assert.deepStrictEqual(paramsOf(ours), await awsPresign(query, credentials));
  });
}

const issue = (body, options = {}) => createTranscriptsAdapter({
  issuers: { 'aws-transcribe': awsTranscribeIssuer({ region: 'us-east-1', credentials: CREDENTIALS, now: () => NOW, ...options }) },
})(new Request('https://adapter.example/issue-connection', { method: 'POST', body: JSON.stringify(body) }));

test('issue-connection answers with a presigned URL, and echoes metadata', async () => {
  const response = await issue({ metadata: { transcriptId: 't-1' }, provider: 'aws-transcribe', languages: ['en-US'], audio: AUDIO, protocols: ['websocket'] });
  assert.strictEqual(response.status, 200);
  const body = await response.json();
  assert.deepStrictEqual(body.metadata, { transcriptId: 't-1' });
  assert.strictEqual(body.provider, 'aws-transcribe');
  assert.strictEqual(body.protocol, 'websocket');
  assert.strictEqual(body.expiresIn, 300);
  assert.strictEqual(body.accessToken, undefined);
  assert.ok(body.url.startsWith(`wss://${HOST}:8443/stream-transcription-websocket?`));
  const params = paramsOf(body.url);
  assert.deepStrictEqual(params, await awsPresign({ 'language-code': 'en-US', 'media-encoding': 'pcm', 'sample-rate': '16000' }));
});

test('several languages ask Transcribe to identify which', async () => {
  const response = await issue({ provider: 'aws-transcribe', languages: ['en-US', 'es-US'], audio: AUDIO, protocols: ['websocket'] });
  const params = paramsOf((await response.json()).url);
  assert.strictEqual(params['identify-language'], 'true');
  assert.strictEqual(params['language-options'], 'en-US,es-US');
  assert.strictEqual(params['language-code'], undefined);
});

test('two channels ask Transcribe to tell them apart', async () => {
  const response = await issue({ provider: 'aws-transcribe', languages: ['en-US'], audio: { ...AUDIO, channelCount: 2 }, protocols: ['websocket'] });
  const params = paramsOf((await response.json()).url);
  assert.strictEqual(params['enable-channel-identification'], 'true');
  assert.strictEqual(params['number-of-channels'], '2');
});

for (const [what, body, field] of [
  ['an encoding Transcribe doesn\'t stream', { audio: { ...AUDIO, encoding: 'mp3' } }, 'audio.encoding'],
  ['only WebRTC', { protocols: ['webrtc'] }, 'protocols'],
  ['three channels', { audio: { ...AUDIO, channelCount: 3 } }, 'audio.channelCount'],
  ['no language and none configured', { languages: undefined }, 'languages'],
  ['a service this adapter doesn\'t issue for', { provider: 'deepgram' }, 'provider'],
]) {
  test(`422 for ${what}`, async () => {
    const response = await issue({ provider: 'aws-transcribe', languages: ['en-US'], audio: AUDIO, protocols: ['websocket'], ...body });
    assert.strictEqual(response.status, 422);
    assert.strictEqual((await response.json()).details[0].field, field);
  });
}

test('a configured language stands in when the request names none', async () => {
  const response = await issue({ provider: 'aws-transcribe', audio: AUDIO, protocols: ['websocket'] }, { languageCode: 'en-US' });
  assert.strictEqual(paramsOf((await response.json()).url)['language-code'], 'en-US');
});

test('400 for a request missing what a connection needs', async () => {
  const response = await issue({ provider: 'aws-transcribe' });
  assert.strictEqual(response.status, 400);
});
