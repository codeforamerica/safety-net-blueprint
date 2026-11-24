import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { discover, load } from '@codeforamerica/blueprint-core';
import { chosenAdapter, chooseAdapter, adaptersCalledBy, withAdapterChoices, eventsSentBy, recordAdapters, NONE, ROUTED } from '../../src/try-it/adapters.js';
import { stubChoices } from '../../src/try-it/stub-editor.js';

const here = dirname(fileURLToPath(import.meta.url));
const docs = discover(join(here, '../../../blueprint-harness/generated/resolved')).map(load);
const api = 'communication-transcription-sessions-adapter';
const whisper = { api, match: { provider: 'whisper' }, handler: { startStream: () => {} } };
const transcribe = { api, match: { provider: 'aws-transcribe' }, to: 'https://transcribe.example.org' };
const where = { scope: 'adapters-test' };

const stored = new Map();
globalThis.sessionStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) };

beforeEach(() => {
  stored.clear();
  globalThis.BlueprintExplorer = { routing: [whisper, transcribe] };
});

describe('what answers an adapter', () => {
  const hold = async () => new Response(null, { status: 202 });

  it('is the site\'s routing until None is chosen, for the tab', () => {
    assert.equal(chosenAdapter(where, api), ROUTED);
    const routing = withAdapterChoices([whisper, transcribe], docs, where, hold);
    assert.deepEqual(routing, [whisper, transcribe]);
  });

  it('under None, waits for the developer on each of the adapter\'s operations', () => {
    chooseAdapter(where, api, NONE);
    assert.equal(chosenAdapter(where, api), NONE);
    const answering = withAdapterChoices([whisper, transcribe], docs, where, hold).filter((e) => e.api === api);
    assert.equal(answering.length, 1);
    assert.deepEqual(Object.keys(answering[0].handler).sort(), ['pauseStream', 'requestCredentials', 'startStream', 'stopStream']);
  });
});

describe('the adapter a record chooses', () => {
  it('follows a field drawn from a registry to the routing entry matching its value', () => {
    const chooses = recordAdapters('TranscriptionProfile', docs);
    assert.deepEqual(chooses.apis, [api]);
    assert.equal(chooses.entryFor({ provider: 'whisper' })[0].entry, whisper);
    assert.equal(chooses.entryFor({ provider: 'aws-transcribe' })[0].entry, transcribe);
    assert.equal(chooses.entryFor({ provider: 'none' })[0].entry, null);
  });

  it('chooses no adapter for a record with no such field', () => {
    assert.deepEqual(recordAdapters('Transcript', docs).apis, []);
  });
});

describe('what the contracts say about an adapter', () => {
  it('names the adapters an action calls, from its state machine', () => {
    const sessions = docs.find((d) => d.type === 'openapi' && d.api === 'communication-transcription-sessions');
    const start = sessions.content.paths['/transcription-sessions/{transcriptionSessionId}/start'].post;
    const list = sessions.content.paths['/transcription-sessions'].get;
    const calledOut = stubChoices(docs).operations;
    assert.deepEqual(adaptersCalledBy(start, calledOut), [api]);
    assert.deepEqual(adaptersCalledBy(list, calledOut), []);
  });

  it('lists what the adapter sends, from its AsyncAPI document, each with an example', () => {
    const events = eventsSentBy(api, docs);
    assert.deepEqual(events.map((e) => e.type.split('.').pop()), ['connected', 'disconnected', 'failed', 'line_updated', 'line_finished', 'ended']);
    assert.equal(events[0].example.type, 'communication.transcription_session.connected');
    assert.deepEqual(events.find((e) => e.type.endsWith('.ended')).dateTimes, ['at']);
    assert.deepEqual(events.find((e) => e.type.endsWith('.line_finished')).dateTimes.sort(), ['endedAt', 'startedAt']);
    assert.deepEqual(events.find((e) => e.type.endsWith('.line_finished')).references, ['transcriptId']);
  });
});
