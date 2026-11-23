/**
 * validateRouting checks routing against its schema and against the contract
 * set it routes, run against the harness's resolved contracts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discover, load, validateRouting } from '../../src/index.js';

const harness = resolve(dirname(fileURLToPath(import.meta.url)), '../../../blueprint-harness/generated/resolved');
const docs = discover(harness).map(load);
const check = (...routing) => validateRouting({ routing }, docs);
const ADAPTER = 'communication-transcription-sessions-adapter';

test('an adapter routed to a module for one provider passes', () => {
  const { errors, warnings } = check({ api: ADAPTER, match: { provider: 'whisper' }, handler: './whisper.js' });
  assert.deepEqual({ errors, warnings }, { errors: [], warnings: [] });
});

test('two implementations of one adapter, by match, pass; the same match twice does not', () => {
  assert.deepEqual(check({ api: ADAPTER, match: { provider: 'whisper' }, handler: './w.js' }, { api: ADAPTER, match: { provider: 'aws-transcribe' }, handler: './t.js' }).errors, []);
  assert.match(check({ api: ADAPTER, match: { provider: 'whisper' }, handler: './w.js' }, { api: ADAPTER, match: { provider: 'whisper' }, handler: './x.js' }).errors[0], /configured more than once/);
});

test('a match value the field does not allow is an error, listing what it does', () => {
  assert.match(check({ api: ADAPTER, match: { provider: 'whispr' }, handler: './w.js' }).errors[0], /matches provider "whispr", which provider doesn't allow\. It allows: .*whisper/);
});

test('a match on a domain is an error', () => {
  assert.deepEqual(check({ domain: 'communication', match: { provider: 'whisper' }, to: 'https://x.example' }).errors,
    ['Routed domain "communication" has a match, so it routes an API or an operation, not a domain']);
});

test('a match on a field no request it routes has is an error', () => {
  assert.match(check({ api: 'intake', match: { provider: 'whisper' }, to: 'https://x.example' }).errors[0], /matches "provider", which no request it routes has/);
});

test('a route takes exactly one of to and handler', () => {
  assert.match(check({ api: 'communication-transcripts', to: 'https://x.example', handler: './a.js' }).errors[0], /exactly one of "to" or "handler"/);
  assert.match(check({ api: 'communication-transcripts' }).errors[0], /needs exactly one of "to" or "handler"/);
});

test('a handler in a file is a JavaScript module', () => {
  assert.match(check({ api: ADAPTER, handler: './whisper.ts' }).errors[0], /handler, in a file, is a JavaScript module/);
});

test('naming something the contracts do not declare is an error, listing what they do', () => {
  assert.match(check({ api: 'communication-transcript', to: 'https://x.example' }).errors[0], /is no API the contracts declare\. APIs: .*communication-transcripts/);
  assert.match(check({ operation: 'createTranscrip', to: 'https://x.example' }).errors[0], /names no operation the contracts declare/);
});

test('every problem is listed, not only the first', () => {
  assert.equal(check({ api: 'nope', to: 'https://x.example' }, { operation: 'nada', to: 'https://x.example' }).errors.length, 2);
});

test('a single operation routed apart from its API warns; an external one does not', () => {
  const apart = check({ operation: 'createTranscript', to: 'https://x.example' });
  assert.deepEqual(apart.errors, []);
  assert.match(apart.warnings[0], /routed apart from the rest of communication-transcripts/);
  assert.deepEqual(check({ operation: 'requestCredentials', to: 'https://x.example' }).warnings, []);
  // Its API routed too: nothing is split.
  assert.deepEqual(check({ api: 'communication-transcripts', to: 'https://a.example' }, { operation: 'createTranscript', to: 'https://b.example' }).warnings, []);
});
