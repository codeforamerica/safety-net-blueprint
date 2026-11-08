/**
 * Null and absent, where value expressions fill something in
 * (docs/conventions/resources.yaml, null_and_absent): an expression that
 * finds nothing leaves its field out, and a null is left out where the
 * schema it goes into doesn't accept one.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { fitToSchema, acceptsNull } from '../../src/payload-fit.js';
import { resolveBodyValue, resolveValue, lookupValue, applySteps } from '../../src/state-machine-engine.js';

const context = { entities: { connection: { url: 'wss://x', subprotocol: null, settings: { note: null } } } };

describe('filling in a body', () => {
  test('leaves out a field an expression finds nothing for', () => {
    assert.deepStrictEqual(resolveBodyValue({ url: '$connection.url', endedAt: '$connection.missing' }, context), { url: 'wss://x' });
  });

  test('keeps a null an expression finds, and a literal null', () => {
    assert.deepStrictEqual(resolveBodyValue({ subprotocol: '$connection.subprotocol', endedAt: null }, context), { subprotocol: null, endedAt: null });
  });

  test('leaves out what finds nothing in a nested object; makes it null in a list', () => {
    assert.deepStrictEqual(
      resolveBodyValue({ settings: { region: '$connection.region' }, ids: ['$connection.url', '$connection.missing'] }, context),
      { settings: {}, ids: ['wss://x', null] },
    );
  });

  test('leaves out a missing $request field like any other', () => {
    assert.deepStrictEqual(resolveBodyValue({ at: '$request.at' }, { request: {} }), {});
  });
});

describe('steps that fill something in', () => {
  test('set: sets nothing when its expression finds nothing, and a null it finds', () => {
    const resource = { id: 'r1', note: 'kept' };
    applySteps([{ set: { field: 'note', value: '$request.note' } }], resource, { request: {}, object: resource }, null);
    assert.strictEqual(resource.note, 'kept');
    applySteps([{ set: { field: 'note', value: '$request.note' } }], resource, { request: { note: null }, object: resource }, null);
    assert.strictEqual(resource.note, null);
  });

  test('emit: leaves out of the data what its expressions find nothing for', () => {
    const { pendingEvents } = applySteps([{ emit: { type: 'test.thing.done', data: { a: '$object.a', b: '$object.b' } } }], {}, { object: { a: 1 } }, null);
    assert.deepStrictEqual(pendingEvents[0].data, { a: 1 });
  });
});

describe('a null and the schema it goes into', () => {
  const SCHEMA = {
    type: 'object',
    properties: {
      subprotocol: { type: 'string' },
      endedAt: { type: ['string', 'null'] },
      settings: { type: 'object', properties: { note: { type: ['string', 'null'] }, region: { type: 'string' } } },
    },
  };

  test('is kept where the property accepts it, and left out where it doesn\'t', () => {
    assert.deepStrictEqual(fitToSchema({ subprotocol: null, endedAt: null }, SCHEMA), { endedAt: null });
  });

  test('is judged by a nested object\'s own properties', () => {
    assert.deepStrictEqual(fitToSchema({ settings: { note: null, region: null } }, SCHEMA), { settings: { note: null } });
  });

  test('is kept where nothing declares the property, or there is no schema', () => {
    assert.deepStrictEqual(fitToSchema({ other: null }, SCHEMA), { other: null });
    assert.deepStrictEqual(fitToSchema({ subprotocol: null }, null), { subprotocol: null });
  });

  test('reads properties declared across allOf and refs', () => {
    const defs = { Fields: { type: 'object', properties: { subprotocol: { type: 'string' } } } };
    const follow = (s) => (s?.$ref ? defs[s.$ref.split('/').pop()] : s);
    assert.deepStrictEqual(fitToSchema({ subprotocol: null }, { allOf: [{ $ref: '#/$defs/Fields' }] }, follow), {});
  });
});

describe('looking a value up, for a guard or a where:', () => {
  test('lookupValue tells a null from nothing', () => {
    assert.strictEqual(lookupValue('$connection.subprotocol', context), null);
    assert.strictEqual(lookupValue('$connection.missing', context), undefined);
  });

  test('a $request path reads nested fields, as $object does', () => {
    const request = { lostStretch: { startedAt: '2026-10-12T10:00:30Z' } };
    assert.strictEqual(lookupValue('$request.lostStretch.startedAt', { request }), '2026-10-12T10:00:30Z');
    assert.strictEqual(lookupValue('$request.lostStretch.endedAt', { request }), undefined);
  });

  test('resolveValue keeps its behavior: nothing is null, a missing $request field undefined', () => {
    assert.strictEqual(resolveValue('$connection.missing', context), null);
    assert.strictEqual(resolveValue('$request.at', { request: {} }), undefined);
  });
});

describe('whether a schema accepts null', () => {
  test('by its type, const or enum', () => {
    assert.strictEqual(acceptsNull({ type: 'string' }), false);
    assert.strictEqual(acceptsNull({ type: ['string', 'null'] }), true);
    assert.strictEqual(acceptsNull({ const: null }), true);
    assert.strictEqual(acceptsNull({ enum: ['a', 'b'] }), false);
    assert.strictEqual(acceptsNull({}), true);
  });

  test('every member of an allOf, and some member of a oneOf', () => {
    assert.strictEqual(acceptsNull({ allOf: [{}, { type: 'string' }] }), false);
    assert.strictEqual(acceptsNull({ oneOf: [{ type: 'string' }, { type: 'null' }] }), true);
  });
});
