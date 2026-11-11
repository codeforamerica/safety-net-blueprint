/**
 * Audio capture's parts that don't need a browser: turning float samples into
 * interleaved 16-bit PCM chunks, and the queue the chunks are read from.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { createInterleaver, createChunkQueue } from '../src/client/audio/capture.js';

const chunksOf = (channelCount, chunkFrames) => {
  const out = [];
  return { write: createInterleaver(channelCount, chunkFrames, (buffer) => out.push(new Int16Array(buffer))), out };
};

test('one channel: samples become 16-bit PCM, a chunk at a time', () => {
  const { write, out } = chunksOf(1, 4);
  write([new Float32Array([0, 1, -1, 0.5, 0.25])]);
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual([...out[0]], [0, 32767, -32768, 16383]);
  write([new Float32Array([0, 0, 0])]);
  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual([...out[1]], [8191, 0, 0, 0]);
});

test('two channels are interleaved, worker then applicant', () => {
  const { write, out } = chunksOf(2, 2);
  write([new Float32Array([1, 0]), new Float32Array([-1, 0.5])]);
  assert.deepStrictEqual([...out[0]], [32767, -32768, 0, 16383]);
});

test('a missing channel is silence, and samples past ±1 are clipped', () => {
  const { write, out } = chunksOf(2, 2);
  write([new Float32Array([2, -3])]);
  assert.deepStrictEqual([...out[0]], [32767, 0, -32768, 0]);
});

test('each chunk is its own buffer, little-endian', () => {
  const { write, out } = chunksOf(1, 1);
  write([new Float32Array([1, -1])]);
  assert.notStrictEqual(out[0].buffer, out[1].buffer);
  assert.deepStrictEqual([...new Uint8Array(out[0].buffer)], [0xff, 0x7f]);
});

test('the interleaver runs from its own source text, as the worklet loads it', () => {
  const rebuilt = new Function(`return (${createInterleaver})`)();
  const out = [];
  rebuilt(1, 2, (buffer) => out.push([...new Int16Array(buffer)]))([new Float32Array([1, 0])]);
  assert.deepStrictEqual(out, [[32767, 0]]);
});

test('the queue gives chunks in order while read, and ignores what comes before', async () => {
  const queue = createChunkQueue();
  queue.push('before connect');
  const iterator = queue[Symbol.asyncIterator]();
  queue.push('a');
  queue.push('b');
  queue.end();
  queue.push('ignored');
  const seen = [];
  for (let next = await iterator.next(); !next.done; next = await iterator.next()) seen.push(next.value);
  assert.deepStrictEqual(seen, ['a', 'b']);
});

test('what is pushed while nobody reads, off the record, is never read', async () => {
  const queue = createChunkQueue();
  const first = (async () => { for await (const chunk of queue) if (chunk === 'on') return chunk; return null; })();
  queue.push('on');
  assert.strictEqual(await first, 'on');
  // The connection closed: its reader stopped, as an adapter's does on pause.
  queue.push('off the record');
  queue.push('still off');
  const second = (async () => { const seen = []; for await (const chunk of queue) seen.push(chunk); return seen; })();
  queue.push('back on');
  queue.end();
  assert.deepStrictEqual(await second, ['back on']);
});
