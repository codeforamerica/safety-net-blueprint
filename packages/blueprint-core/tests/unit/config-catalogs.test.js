/**
 * A config catalog names the resource it seeds, and that resource says where
 * each of its records came from.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { toDoc } from '../../src/doc.js';
import { validate } from '../../src/validate.js';

const api = (properties) => toDoc({
  path: '/set/domains/workflow/workflow-openapi.yaml',
  relativePath: 'domains/workflow/workflow-openapi.yaml',
  type: 'openapi',
  content: {
    openapi: '3.1.0',
    info: { title: 'Workflow', version: '1.0.0', 'x-domain': 'workflow' },
    servers: [{ url: '/workflow' }],
    paths: {
      '/queues/{queueId}': {
        get: { responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Queue' } } } } } },
      },
    },
    components: { schemas: { Queue: { type: 'object', properties } } },
  },
});

const config = (catalog) => toDoc({
  path: '/set/domains/workflow/workflow-config.yaml',
  relativePath: 'domains/workflow/workflow-config.yaml',
  type: 'config',
  content: { version: '1.0', domain: 'workflow', queues: catalog },
});

const errorsOf = (docs, rule) => validate(docs).results
  .flatMap((r) => r.errors)
  .filter((e) => e.rule === rule);

describe('a config catalog', () => {
  test('seeding a resource that declares source is clean', () => {
    const docs = [api({ id: { type: 'string' }, source: { enum: ['system', 'user'] } }), config({ resource: 'Queue', entries: [{ id: 'q1' }] })];
    assert.deepEqual(errorsOf(docs, 'unknown-config-resource'), []);
    assert.deepEqual(errorsOf(docs, 'config-resource-without-source'), []);
  });

  test('naming a resource no API in the domain serves is an error', () => {
    const [error] = errorsOf([api({ source: { type: 'string' } }), config({ resource: 'Queu', entries: [] })], 'unknown-config-resource');
    assert.match(error.message, /Catalog "queues" seeds Queu, which no OpenAPI document in domain "workflow" serves/);
  });

  test('seeding a resource that does not declare source is an error', () => {
    const [error] = errorsOf([api({ id: { type: 'string' } }), config({ resource: 'Queue', entries: [] })], 'config-resource-without-source');
    assert.match(error.message, /Queue is seeded by catalog "queues" but does not declare `source`/);
  });

  test('a bare list, as catalogs once were, is an error rather than seeding nothing', () => {
    const [error] = errorsOf([api({ source: { type: 'string' } }), config([{ id: 'q1' }])], 'not-a-catalog');
    assert.match(error.message, /"queues" is not a catalog/);
  });
});
