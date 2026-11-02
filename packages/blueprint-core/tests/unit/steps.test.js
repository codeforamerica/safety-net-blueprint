/**
 * Every check and generator that looks for one kind of step walks the same
 * steps, at any depth.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { everyStep } from '../../src/steps.js';

test('reaches steps inside then, else, do, catch, forEach and every when branch', () => {
  const steps = [
    { id: 'top', if: 'x', then: [{ id: 'then' }], else: [{ id: 'else' }] },
    { id: 'loop', forEach: { in: '$xs', as: 'x' }, do: [{ id: 'do' }] },
    { id: 'inner-loop', forEach: { in: '$xs', as: 'x', do: [{ id: 'forEach.do' }] } },
    { id: 'call', call: { operationId: 'x' }, catch: { do: [{ id: 'catch' }] } },
    { id: 'match', match: 'x', when: { a: [{ id: 'when-a' }], b: [{ id: 'when-b', then: [{ id: 'deep' }] }] } },
  ];
  assert.deepEqual([...everyStep(steps)].map((s) => s.id), [
    'top', 'then', 'else', 'loop', 'do', 'inner-loop', 'forEach.do', 'call', 'catch', 'match', 'when-a', 'when-b', 'deep',
  ]);
});

test('skips what isn\'t a list of steps, and what isn\'t a step', () => {
  assert.deepEqual([...everyStep(undefined)], []);
  assert.deepEqual([...everyStep([null, 'text', { id: 'kept' }])].map((s) => s.id), ['kept']);
});
