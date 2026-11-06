/**
 * Polymorphic references name their type field, which is an enum whose values
 * each name a resource: in snake_case, through the mapping, or External.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDoc } from '../../../src/doc.js';
import { polymorphicReferenceErrors } from '../../../src/validator/polymorphic-validator.js';

const returns = (name) => ({ get: { responses: { 200: { content: { 'application/json': { schema: { $ref: `#/components/schemas/${name}` } } } } } } });

const set = (link) => [toDoc({
  path: '/set/domains/docs/docs-openapi.yaml',
  relativePath: 'domains/docs/docs-openapi.yaml',
  type: 'openapi',
  content: {
    openapi: '3.1.0',
    info: { title: 'Docs', version: '1.0.0', 'x-domain': 'docs' },
    paths: {
      '/applications/{applicationId}': returns('Application'),
      '/cases/{caseId}': returns('Case'),
      '/links/{linkId}': returns('DocumentLink'),
    },
    components: { schemas: { Application: { type: 'object' }, Case: { type: 'object' }, DocumentLink: link } },
  },
})];

const link = ({ type = { type: 'string', enum: ['application', 'case'] }, relationship = {} } = {}) => ({
  type: 'object',
  properties: {
    subjectType: type,
    subjectId: {
      type: 'string', format: 'uuid',
      'x-relationship': { resource: 'Polymorphic', discriminator: { propertyName: 'subjectType' }, ...relationship },
    },
  },
});

const rules = (docs) => [...polymorphicReferenceErrors(docs).values()].flat().map((e) => e.rule);

test('values that name resources in snake_case pass', () => {
  assert.deepEqual(rules(set(link())), []);
});

test('a reference must name its type field', () => {
  const missing = link({ relationship: { discriminator: undefined } });
  assert.deepEqual(rules(set(missing)), ['polymorphic-type-field']);
  const wrong = link({ relationship: { discriminator: { propertyName: 'kind' } } });
  assert.deepEqual(rules(set(wrong)), ['polymorphic-type-field']);
});

test('the type field must be an enum', () => {
  assert.deepEqual(rules(set(link({ type: { type: 'string' } }))), ['polymorphic-type-not-enum']);
});

test('a value that names no resource fails, unless mapped to one or to External', () => {
  const typo = link({ type: { type: 'string', enum: ['application', 'cse'] } });
  assert.deepEqual(rules(set(typo)), ['polymorphic-type-names-nothing']);
  const mapped = link({
    type: { type: 'string', enum: ['application', 'matter', 'chat'] },
    relationship: { discriminator: { propertyName: 'subjectType', mapping: { matter: 'Case', chat: 'External' } } },
  });
  assert.deepEqual(rules(set(mapped)), []);
});

test('null, for a record naming nothing, is not a type', () => {
  assert.deepEqual(rules(set(link({ type: { type: ['string', 'null'], enum: ['application', null] } }))), []);
});
