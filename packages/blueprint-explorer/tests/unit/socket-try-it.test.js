import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extract } from '@codeforamerica/blueprint-core';
import { mixTo, toLinear16 } from '../../src/try-it/audio.js';
import { messagesToSend, localUrl, declaredFormat, stubNeeded } from '../../src/try-it/socket-panel.js';
import { stubChoices } from '../../src/try-it/stub-editor.js';
import { adapterFor } from '../../src/try-it/session-adapters.js';

const contracts = JSON.parse(readFileSync(new URL('../../../blueprint-harness/generated/contracts.json', import.meta.url), 'utf8'));
const docs = extract(contracts, 'docs');
const relay = docs.find((d) => d.api === 'communication-transcripts-relay');

describe('mixTo', () => {
  it('mixes channels down to one by averaging them', () => {
    const [mixed] = mixTo([Float32Array.of(1, 0), Float32Array.of(0, 1)], 1);
    assert.deepEqual([...mixed], [0.5, 0.5]);
  });

  it('repeats the last channel where the recording has fewer', () => {
    const mono = Float32Array.of(0.25);
    assert.deepEqual(mixTo([mono], 2), [mono, mono]);
  });
});

describe('toLinear16', () => {
  it('writes 16-bit signed little-endian samples, channels interleaved, clipped to full scale', () => {
    const view = new DataView(toLinear16([Float32Array.of(1, -1), Float32Array.of(0, 2)], 0, 2));
    assert.deepEqual([0, 2, 4, 6].map((at) => view.getInt16(at, true)), [32767, 0, -32768, 32767]);
  });
});

describe('the relay in Try it', () => {
  it('sends the messages the relay receives, starting start from its schema', () => {
    const messages = messagesToSend(relay, docs);
    assert.deepEqual(messages.map((m) => m.name), ['start', 'audio', 'keepalive', 'finalize', 'end']);
    assert.equal(messages.find((m) => m.name === 'audio').binary, true);
    assert.deepEqual(messages.find((m) => m.name === 'start').start, {
      type: 'start', audio: { encoding: 'linear16', sampleRateHertz: 16000, channelCount: 1 },
    });
  });

  it('connects where the mock serves it', () => {
    assert.equal(localUrl(relay), 'ws://localhost:1080/communication/transcripts-relay');
  });

  it('takes the audio format from the message that declared one', () => {
    assert.deepEqual(declaredFormat({ type: 'start', audio: { encoding: 'linear16', sampleRateHertz: 8000 } }),
      { encoding: 'linear16', sampleRateHertz: 8000, channelCount: 1 });
    assert.equal(declaredFormat({ type: 'end' }), null);
  });

  it('reads the stub the mock needs from its 1011 close, as the stub editor names it', () => {
    const needed = stubNeeded(relay, 'start is answered with started or error, and no WebSocket stub gives one; register one at POST /mock/stubs/ws');
    assert.deepEqual(needed, { channel: 'communication-transcripts-relay-asyncapi.yaml#/channels/audio', on: 'start' });
    const channel = stubChoices(docs).channels.find((c) => c.value === needed.channel);
    assert.deepEqual(channel.repliesTo('start'), ['started', 'error']);
    assert.equal(stubNeeded(relay, 'Closed from Try it'), null);
  });
});

describe('the session adapter for a profile', () => {
  it('is the one for its service, the site\'s before the explorer\'s Whisper', () => {
    globalThis.BlueprintExplorer = { sessionAdapters: [] };
    assert.equal(adapterFor('whisper')?.name, 'Whisper in this page');
    assert.equal(adapterFor('aws-transcribe'), null);
    const transcribe = { service: 'aws-transcribe', name: 'Amazon Transcribe' };
    const ownWhisper = { service: 'whisper', name: 'Whisper on our server' };
    globalThis.BlueprintExplorer.sessionAdapters = [transcribe, ownWhisper];
    assert.equal(adapterFor('aws-transcribe'), transcribe);
    assert.equal(adapterFor('whisper'), ownWhisper);
  });
});
