import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extract } from '@codeforamerica/blueprint-core';
import { mixTo, toLinear16 } from '../../src/try-it/audio.js';
import { messagesToSend, localUrl, declaredFormat } from '../../src/try-it/socket-panel.js';

const docs = extract(JSON.parse(readFileSync(new URL('../../../blueprint-harness/generated/contracts.json', import.meta.url), 'utf8')), 'docs');
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
});
