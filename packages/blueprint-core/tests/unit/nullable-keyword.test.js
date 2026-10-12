/**
 * `nullable` is the OpenAPI 3.0 spelling; 3.1 documents say `type: [X, "null"]`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDoc } from '../../src/doc.js';
import { validate } from '../../src/validate.js';

const api = (schemas) => toDoc({
  path: '/set/domains/demo/demo-openapi.yaml',
  relativePath: 'domains/demo/demo-openapi.yaml',
  type: 'openapi',
  content: { openapi: '3.1.0', info: { title: 'Demo', version: '1', 'x-domain': 'demo' }, paths: {}, components: { schemas } },
});

const nullableErrors = (doc) => validate([doc]).results.flatMap((r) => r.errors).filter((e) => e.rule === 'nullable-keyword');

test('nullable: true is an error naming where it is', () => {
  const [error] = nullableErrors(api({ Thing: { type: 'object', properties: { closedAt: { type: 'string', nullable: true } } } }));
  assert.match(error.message, /\/components\/schemas\/Thing\/properties\/closedAt uses `nullable`/);
});

test('a type array is clean, and so is a property named nullable', () => {
  const doc = api({ Thing: { type: 'object', properties: { closedAt: { type: ['string', 'null'] }, nullable: { type: 'boolean' } } } });
  assert.deepEqual(nullableErrors(doc), []);
});
