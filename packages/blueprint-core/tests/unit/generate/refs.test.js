/**
 * Unit tests for generate/refs.js
 *
 * A generated overlay is built without knowing where its target spec sits, so
 * its component refs are rewritten to whatever prefix that spec already uses.
 * Ported from the CLI's detectComponentPrefix and rewriteOverlayRefs tests.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { detectComponentPrefix, rewriteComponentRefs } from '../../../src/generate/refs.js';

describe('detectComponentPrefix', () => {
  test('detects the ./ prefix', () => {
    const spec = {
      paths: { '/items': { get: { responses: { '400': { $ref: './components/responses.yaml#/BadRequest' } } } } },
    };

    assert.equal(detectComponentPrefix(spec), './');
  });

  test('detects a deeper relative prefix', () => {
    const spec = {
      paths: { '/items': { get: { responses: { '400': { $ref: '../../contracts/components/responses.yaml#/BadRequest' } } } } },
    };

    assert.equal(detectComponentPrefix(spec), '../../contracts/');
  });

  test('ignores internal refs', () => {
    // `#/components/…` is a pointer within the document, not an external file.
    const spec = {
      paths: {
        '/items': {
          get: {
            responses: {
              '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } } },
            },
          },
        },
      },
    };

    assert.equal(detectComponentPrefix(spec), './');
  });

  test('defaults to ./ when a spec has no refs at all', () => {
    assert.equal(detectComponentPrefix({ info: { title: 'Test' } }), './');
  });

  test('finds a ref nested in an array', () => {
    const spec = {
      paths: { '/items': { get: { parameters: [{ $ref: '../shared/components/parameters.yaml#/LimitParam' }] } } },
    };

    assert.equal(detectComponentPrefix(spec), '../shared/');
  });
});

describe('rewriteComponentRefs', () => {
  test('rewrites every matching prefix', () => {
    const overlay = {
      actions: [{
        target: '$.paths',
        update: {
          '/items/{id}/approve': {
            post: {
              responses: {
                '400': { $ref: './components/responses.yaml#/BadRequest' },
                '404': { $ref: './components/responses.yaml#/NotFound' },
              },
            },
          },
        },
      }],
    };

    const result = rewriteComponentRefs(overlay, './', '../../contracts/');
    const responses = result.actions[0].update['/items/{id}/approve'].post.responses;

    assert.equal(responses['400'].$ref, '../../contracts/components/responses.yaml#/BadRequest');
    assert.equal(responses['404'].$ref, '../../contracts/components/responses.yaml#/NotFound');
  });

  test('returns the same object when the prefixes already match', () => {
    const overlay = { actions: [{ target: '$.paths', update: {} }] };
    assert.equal(rewriteComponentRefs(overlay, './', './'), overlay);
  });

  test('leaves internal refs alone', () => {
    const overlay = {
      actions: [{
        target: '$.paths',
        update: {
          '/items/{id}/approve': {
            post: {
              responses: {
                '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } } },
              },
            },
          },
        },
      }],
    };

    const result = rewriteComponentRefs(overlay, './', '../../contracts/');
    const schema = result.actions[0].update['/items/{id}/approve'].post
      .responses['200'].content['application/json'].schema;

    assert.equal(schema.$ref, '#/components/schemas/Item');
  });

  test('leaves a ref that does not start with the from-prefix', () => {
    const overlay = { actions: [{ update: { x: { $ref: '../other/components/responses.yaml#/BadRequest' } } }] };
    const result = rewriteComponentRefs(overlay, './', '../../contracts/');

    assert.equal(result.actions[0].update.x.$ref, '../other/components/responses.yaml#/BadRequest');
  });

  test('does not mutate the original overlay', () => {
    const overlay = { actions: [{ update: { x: { $ref: './components/responses.yaml#/BadRequest' } } }] };
    rewriteComponentRefs(overlay, './', '../../contracts/');

    assert.equal(overlay.actions[0].update.x.$ref, './components/responses.yaml#/BadRequest');
  });
});
