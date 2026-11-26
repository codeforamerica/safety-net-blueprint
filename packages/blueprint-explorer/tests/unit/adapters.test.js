import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { discover, load } from '@codeforamerica/blueprint-core';
import { answeredFromExamples } from '../../src/try-it/adapters.js';

const here = dirname(fileURLToPath(import.meta.url));
const docs = discover(join(here, '../../../blueprint-harness/generated/resolved')).map(load);
const api = 'communication-transcription-sessions-adapter';
const whisper = { api, match: { provider: 'whisper' }, handler: { startStream: () => {} } };
const transcribe = { api, match: { provider: 'aws-transcribe' }, to: 'https://transcribe.example.org' };

describe('answering an adapter from its contract', () => {
  it('replaces the site\'s routing for the adapter with its example responses', async () => {
    const answering = answeredFromExamples([whisper, transcribe], docs).filter((e) => e.api === api);
    assert.equal(answering.length, 1);
    assert.deepEqual(Object.keys(answering[0].handler).sort(), ['pauseStream', 'requestCredentials', 'startStream', 'stopStream']);
    const started = await answering[0].handler.startStream();
    assert.equal(started.status, 202);
  });
});
