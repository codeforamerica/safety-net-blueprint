/**
 * Unit tests for shared internal utilities (src/utils.js).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractPathParams, buildParameterIndex } from '../../src/utils.js';

// ---------------------------------------------------------------------------
// extractPathParams
// ---------------------------------------------------------------------------

describe('extractPathParams', () => {
  test('extracts single param', () => {
    assert.deepEqual(extractPathParams('/applications/{applicationId}/review'), ['applicationId']);
  });

  test('extracts multiple params', () => {
    assert.deepEqual(
      extractPathParams('/applications/{applicationId}/members/{memberId}'),
      ['applicationId', 'memberId']
    );
  });

  test('returns empty array for paths with no params', () => {
    assert.deepEqual(extractPathParams('/health'), []);
  });
});

// ---------------------------------------------------------------------------
// buildParameterIndex
// ---------------------------------------------------------------------------

describe('buildParameterIndex', () => {
  const sampleSpec = {
    components: {
      parameters: {
        ApplicationIdParam: { name: 'applicationId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }
      }
    }
  };

  test('builds index from components.parameters', () => {
    const index = buildParameterIndex([{ relativePath: 'test-openapi.yaml', spec: sampleSpec }]);
    assert.ok(index.has('applicationId'));
    assert.equal(index.get('applicationId'), '#/components/parameters/ApplicationIdParam');
  });

  test('returns empty map when no parameters defined', () => {
    const index = buildParameterIndex([{ relativePath: 'test.yaml', spec: { openapi: '3.1.0' } }]);
    assert.equal(index.size, 0);
  });

  test('first-writer wins across multiple files', () => {
    const spec1 = { components: { parameters: { ApplicationIdParam: { name: 'applicationId', in: 'path' } } } };
    const spec2 = { components: { parameters: { ApplicationIdParamV2: { name: 'applicationId', in: 'path' } } } };
    const index = buildParameterIndex([
      { relativePath: 'a.yaml', spec: spec1 },
      { relativePath: 'b.yaml', spec: spec2 }
    ]);
    assert.equal(index.get('applicationId'), '#/components/parameters/ApplicationIdParam');
  });
});
