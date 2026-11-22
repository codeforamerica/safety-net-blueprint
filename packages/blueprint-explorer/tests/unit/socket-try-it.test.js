import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extract } from '@codeforamerica/blueprint-core';
import { mixTo, toLinear16 } from '../../src/try-it/audio.js';
import { messagesToSend, localUrl, declaredFormat, stubNeeded } from '../../src/try-it/socket-panel.js';
import { stubChoices } from '../../src/try-it/stub-editor.js';
import { InPageRelay, heard } from '../../src/try-it/in-page-relay.js';
import { createMockServer } from '@codeforamerica/blueprint-mock-server/server';

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

describe('the relay in this page', () => {
  // Whisper stands aside: a transcriber that hears the same words in any stretch.
  const said = { text: 'Can you tell me who lives with you?', words: [{ word: 'Can', startMs: 0, endMs: 200 }, { word: 'you', startMs: 200, endMs: 400 }] };
  InPageRelay.transcriber = async () => async () => said;

  /** 100 ms of 16 kHz linear16: a tone, or silence. */
  const frame = (loud) => {
    const samples = new Int16Array(1600);
    if (loud) for (let i = 0; i < samples.length; i += 1) samples[i] = Math.round(8000 * Math.sin(i / 4));
    return samples.buffer;
  };

  /** A conversation with the relay, through a mock that checks it against the contract. */
  async function converse(start, then) {
    const mock = await createMockServer({ contracts, seed: false, routing: [{ api: 'communication-transcripts-relay', handler: InPageRelay }] });
    const socket = new mock.WebSocket(localUrl(relay), ['blueprint.transcripts.relay.v1']);
    const heard = [];
    const closed = new Promise((resolve) => socket.addEventListener('close', (event) => resolve({ code: event.code, reason: event.reason })));
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      heard.push(message);
      if (message.type === 'started') then(socket);
    });
    socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'start', ...start })));
    return { close: await closed, heard };
  }

  it('answers speech with results, final at a pause, then ended after end', async () => {
    const { close, heard } = await converse({ audio: { encoding: 'linear16', sampleRateHertz: 16000, channelCount: 1 } }, async (socket) => {
      for (let i = 0; i < 20; i += 1) socket.send(frame(true));
      for (let i = 0; i < 8; i += 1) socket.send(frame(false));
      await new Promise((resolve) => setTimeout(resolve, 20));
      socket.send(JSON.stringify({ type: 'end' }));
    });
    assert.equal(close.code, 1000);
    assert.deepEqual(heard.map((m) => m.type), ['started', 'result', 'result', 'ended']);
    const [, interim, final] = heard;
    assert.equal(interim.isFinal, false);
    assert.deepEqual([final.isFinal, final.id, final.startOffsetMs], [true, interim.id, 0]);
    assert.equal(final.alternatives[0].transcript, said.text);
    assert.deepEqual(final.alternatives[0].words[1], { word: 'you', startOffsetMs: 200, endOffsetMs: 400 });
  });

  it('refuses a language it doesn\'t hear', async () => {
    const { close, heard } = await converse({ audio: { encoding: 'linear16', sampleRateHertz: 16000, channelCount: 1 }, languages: ['es-US'] }, () => {});
    assert.deepEqual(heard.map((m) => [m.type, m.code]), [['error', 'language-not-supported']]);
    assert.equal(close.code, 1008);
  });

  it('hears interleaved channels at another rate as one at Whisper\'s', () => {
    // Two channels at 8 kHz, 100 ms: left full, right silent.
    const pcm = new Int16Array(1600);
    for (let i = 0; i < pcm.length; i += 2) pcm[i] = 16384;
    const mono = heard(pcm.buffer, { sampleRateHertz: 8000, channelCount: 2 });
    assert.equal(mono.length, 1600);
    assert.equal(mono[10], 0.25);
  });
});
