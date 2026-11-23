import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extract } from '@codeforamerica/blueprint-core';
import { mixTo, toLinear16 } from '../../src/try-it/audio.js';
import { messagesToSend, localUrl, declaredFormat, stubNeeded } from '../../src/try-it/socket-panel.js';
import { stubChoices } from '../../src/try-it/stub-editor.js';
import { sessionAdapter } from '../../src/session-adapter.js';

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

describe('a session adapter, as routing handlers', () => {
  it('starts the adapter after answering, publishes with the session and transcript, and ends after a stop', async () => {
    const published = [];
    let heard = null;
    const context = {
      params: { transcriptionSessionId: 's1' },
      publish: async (event, data, { subject }) => { published.push([event, data, subject]); return { status: 201, body: {} }; },
      call: async () => ({ status: 200, body: {} }),
    };
    const { startStream, stopStream } = sessionAdapter({
      async start({ audio, publish }) {
        heard = audio;
        await publish('connected', {});
        return { async stop() { await publish('line_finished', { key: 'l1' }); } };
      },
    }, { audioFor: () => null });
    const started = await startStream(new Request('http://x/streams', { method: 'POST', body: JSON.stringify({ transcriptionSessionId: 's1', transcriptId: 't1', provider: 'whisper', metadata: { a: 1 } }) }), context);
    assert.equal(started.status, 202);
    assert.deepEqual(await started.json(), { metadata: { a: 1 } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(heard?.frames, 'with no audio chosen, it hears silence');
    assert.equal((await stopStream(new Request('http://x/streams/s1/stop', { method: 'POST' }), context)).status, 202);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(published.map(([event, data, subject]) => [event, data.transcriptId, subject]), [
      ['transcription_session.connected', 't1', 's1'],
      ['transcription_session.line_finished', 't1', 's1'],
      ['transcription_session.ended', 't1', 's1'],
    ]);
  });
});
