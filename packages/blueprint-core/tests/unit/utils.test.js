/**
 * Unit tests for shared OpenAPI utilities (src/openapi/utils.js).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractPathParams, buildParameterIndex, inferTagFromPath, buildPathEntry, extractIndividualResources } from '../../src/openapi/utils.js';

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

// ---------------------------------------------------------------------------
// inferTagFromPath
// ---------------------------------------------------------------------------

describe('inferTagFromPath', () => {
  test('returns title-cased first static segment', () => {
    assert.equal(inferTagFromPath('/applications/{applicationId}/summary'), 'Applications');
  });

  test('converts kebab-case to title case', () => {
    assert.equal(inferTagFromPath('/case-workers/{id}/tasks'), 'Case Workers');
  });

  test('skips leading param segments', () => {
    assert.equal(inferTagFromPath('/{id}/sub-resource'), 'Sub Resource');
  });

  test('returns Other for empty path', () => {
    assert.equal(inferTagFromPath('/'), 'Other');
  });
});

// ---------------------------------------------------------------------------
// buildPathEntry
// ---------------------------------------------------------------------------

describe('buildPathEntry', () => {
  const op = { summary: 'Do thing', operationId: 'doThing', responses: {} };

  test('injects tag inferred from path', () => {
    const entry = buildPathEntry('/applications/{id}/summary', 'get', op);
    assert.deepEqual(entry.get.tags, ['Applications']);
  });

  test('resolves path params via index', () => {
    const paramIndex = new Map([['id', '#/components/parameters/ApplicationIdParam']]);
    const entry = buildPathEntry('/applications/{id}/summary', 'get', op, paramIndex);
    assert.deepEqual(entry.parameters, [{ $ref: '#/components/parameters/ApplicationIdParam' }]);
  });

  test('falls back to inline param when not in index', () => {
    const entry = buildPathEntry('/applications/{id}/summary', 'get', op);
    assert.deepEqual(entry.parameters, [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }]);
  });

  test('omits parameters key when path has no params', () => {
    const entry = buildPathEntry('/applications', 'get', op);
    assert.equal(entry.parameters, undefined);
  });

  test('places operation under correct method key', () => {
    const entry = buildPathEntry('/applications', 'post', op);
    assert.ok(entry.post);
    assert.equal(entry.get, undefined);
  });

  test('injects x-relationship when provided', () => {
    const xRel = { type: 'ruleset', domain: 'eligibility', id: 'expeditedSnap' };
    const entry = buildPathEntry('/applications', 'post', op, new Map(), xRel);
    assert.deepEqual(entry.post['x-relationship'], xRel);
  });

  test('omits x-relationship when not provided', () => {
    const entry = buildPathEntry('/applications', 'post', op);
    assert.equal(entry.post['x-relationship'], undefined);
  });
});

// ---------------------------------------------------------------------------
// extractIndividualResources
// ---------------------------------------------------------------------------

describe('extractIndividualResources', () => {
  /** Run it with console.warn captured. */
  const extracted = (examples) => {
    const originalWarn = console.warn;
    const warnings = [];
    console.warn = (msg) => warnings.push(msg);
    try {
      return { resources: extractIndividualResources(examples), warnings };
    } finally {
      console.warn = originalWarn;
    }
  };

  // A basket holds the things in it under `items`, and is still a record.
  test('keeps a record that has an items array of its own', () => {
    const { resources, warnings } = extracted({
      BasketExample1: { id: 'b1', label: 'two apples', items: [{ name: 'apple', quantity: 2 }] },
      BasketExample2: { id: 'b2', label: 'no items field' },
    });
    assert.deepEqual(resources.map((r) => r.key), ['BasketExample1', 'BasketExample2']);
    assert.deepEqual(warnings, []);
  });

  test('keeps a record whose key says create, update or payload', () => {
    const { resources } = extracted({
      CreateRequestLogExample1: { id: 'r1' },
      PayloadTemplateExample1: { id: 'p1' },
      UpdateScheduleExample1: { id: 'u1' },
    });
    assert.equal(resources.length, 3);
  });

  test('leaves out a list response, with a warning naming it', () => {
    const { resources, warnings } = extracted({
      BasketListExample: { items: [{ id: 'b1' }], total: 1, limit: 25, offset: 0 },
    });
    assert.deepEqual(resources, []);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes('BasketListExample'));
    assert.ok(warnings[0].includes('list response'));
  });

  test('leaves out an example with no id, such as a request body, with a warning naming it', () => {
    const { resources, warnings } = extracted({ BasketCreateExample: { label: 'new basket' } });
    assert.deepEqual(resources, []);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes('BasketCreateExample'));
    assert.ok(warnings[0].includes('no id'));
  });
});
