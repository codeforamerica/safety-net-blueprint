/**
 * Holding domain events: the ones a hold picks reach listeners only when it's
 * released, in the order they were sent, and never when it's discarded; the
 * rest pass through.
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert';
import { eventBus } from '../../src/event-bus.js';

const received = [];
const listener = (event) => received.push(event.id);

afterEach(() => {
  eventBus.off('domain-event', listener);
  received.length = 0;
});

const send = (id, causationid) => eventBus.emit('domain-event', { id, causationid });

test('held events reach listeners only on release, in order', () => {
  eventBus.on('domain-event', listener);
  const hold = eventBus.hold((event) => event.causationid === 'patch-1');
  send('a', 'patch-1');
  send('b', 'patch-1');
  assert.deepStrictEqual(received, []);
  hold.release();
  assert.deepStrictEqual(received, ['a', 'b']);
});

test('discarded events never reach listeners', () => {
  eventBus.on('domain-event', listener);
  const hold = eventBus.hold((event) => event.causationid === 'patch-1');
  send('a', 'patch-1');
  hold.discard();
  assert.deepStrictEqual(received, []);
  send('after', 'patch-1');
  assert.deepStrictEqual(received, ['after']);
});

test('events a hold does not pick pass through while it is open', () => {
  eventBus.on('domain-event', listener);
  const hold = eventBus.hold((event) => event.causationid === 'patch-1');
  send('other', 'something-else');
  assert.deepStrictEqual(received, ['other']);
  hold.discard();
});
