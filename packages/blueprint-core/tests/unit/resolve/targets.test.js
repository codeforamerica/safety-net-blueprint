/**
 * Unit tests for resolve/targets.js
 *
 * An action naming a JSONPath but no file has to be matched to documents.
 * Resolving to several without a disambiguator applies to nothing and says
 * why — silently patching an arbitrary one would be worse than not patching.
 *
 * Ported from the CLI's target-api / target-version tests, which drove the
 * same logic through temp directories; here the document set is built
 * directly, since that is what the pass takes.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveActionTargets } from '../../../src/resolve/targets.js';
import { doc } from '../../helpers/docs.js';

/**
 * @param {string} relativePath
 * @param {object} [options]
 * @param {string} [options.apiId] - info.x-api-id
 * @param {object} [options.paths] - paths object
 * @returns {import('../../../types.js').Doc}
 */
const apiSpec = (relativePath, { apiId, paths = { '/items': { get: {} } } } = {}) => doc(
  { openapi: '3.1.0', info: { title: 'Test', version: '1.0.0', ...(apiId ? { 'x-api-id': apiId } : {}) }, paths },
  { relativePath, type: 'openapi' }
);

describe('resolveActionTargets — explicit files', () => {
  test('matches a document by relative path', () => {
    const intake = apiSpec('domains/intake/intake-openapi.yaml');
    const eligibility = apiSpec('domains/eligibility/eligibility-openapi.yaml');

    const { targets, warnings } = resolveActionTargets(
      { target: '$.paths', file: 'domains/intake/intake-openapi.yaml', update: {} },
      [intake, eligibility]
    );

    assert.deepEqual(targets, [intake]);
    assert.deepEqual(warnings, []);
  });

  test('matches a JSON Schema by its canonical $id', () => {
    // A schema can be addressed without knowing path conventions.
    const schema = doc(
      { $id: 'https://blueprint.codeforamerica.org/base/schemas/events.yaml', $defs: { Event: {} } },
      { relativePath: 'base/schemas/events.yaml', type: 'schema' }
    );

    const { targets } = resolveActionTargets(
      { target: '$.$defs', file: 'https://blueprint.codeforamerica.org/base/schemas/events.yaml', update: {} },
      [schema]
    );

    assert.deepEqual(targets, [schema]);
  });

  test('warns when a named file does not contain the target', () => {
    const intake = apiSpec('domains/intake/intake-openapi.yaml');

    const { targets, warnings } = resolveActionTargets(
      { target: '$.webhooks', file: 'domains/intake/intake-openapi.yaml', update: {} },
      [intake]
    );

    assert.deepEqual(targets, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /does not exist in specified file/);
  });

  test('accepts a list of files', () => {
    const intake = apiSpec('domains/intake/intake-openapi.yaml');
    const eligibility = apiSpec('domains/eligibility/eligibility-openapi.yaml');

    const { targets } = resolveActionTargets(
      {
        target: '$.paths',
        files: ['domains/intake/intake-openapi.yaml', 'domains/eligibility/eligibility-openapi.yaml'],
        update: {},
      },
      [intake, eligibility]
    );

    assert.equal(targets.length, 2);
  });
});

describe('resolveActionTargets — target-api', () => {
  test('matches the spec carrying that x-api-id', () => {
    const intake = apiSpec('domains/intake/intake-openapi.yaml', { apiId: 'intake' });
    const eligibility = apiSpec('domains/eligibility/eligibility-openapi.yaml', { apiId: 'eligibility' });

    const { targets, warnings } = resolveActionTargets(
      { target: '$.paths', 'target-api': 'eligibility', update: {} },
      [intake, eligibility]
    );

    assert.deepEqual(targets, [eligibility]);
    assert.deepEqual(warnings, []);
  });

  test('warns when no spec carries that x-api-id', () => {
    const intake = apiSpec('domains/intake/intake-openapi.yaml', { apiId: 'intake' });

    const { targets, warnings } = resolveActionTargets(
      { target: '$.paths', 'target-api': 'nonexistent', update: {} },
      [intake]
    );

    assert.deepEqual(targets, []);
    assert.match(warnings[0], /none passed target-api\/target-version filters/);
  });
});

describe('resolveActionTargets — target-version', () => {
  test('matches the -vN suffix', () => {
    const v1 = apiSpec('domains/intake/intake-openapi.yaml');
    const v2 = apiSpec('domains/intake/intake-openapi-v2.yaml');

    const { targets } = resolveActionTargets(
      { target: '$.paths', 'target-version': 2, update: {} },
      [v1, v2]
    );

    assert.deepEqual(targets, [v2]);
  });

  test('no suffix means version 1', () => {
    const v1 = apiSpec('domains/intake/intake-openapi.yaml');
    const v2 = apiSpec('domains/intake/intake-openapi-v2.yaml');

    const { targets } = resolveActionTargets(
      { target: '$.paths', 'target-version': 1, update: {} },
      [v1, v2]
    );

    assert.deepEqual(targets, [v1]);
  });
});

describe('resolveActionTargets — ambiguity', () => {
  test('a single match needs no disambiguator', () => {
    const intake = apiSpec('domains/intake/intake-openapi.yaml');

    const { targets, warnings } = resolveActionTargets({ target: '$.paths', update: {} }, [intake]);

    assert.deepEqual(targets, [intake]);
    assert.deepEqual(warnings, []);
  });

  test('several matches without a disambiguator applies to nothing and names them', () => {
    const intake = apiSpec('domains/intake/intake-openapi.yaml');
    const eligibility = apiSpec('domains/eligibility/eligibility-openapi.yaml');

    const { targets, warnings } = resolveActionTargets({ target: '$.paths', update: {} }, [intake, eligibility]);

    assert.deepEqual(targets, []);
    assert.match(warnings[0], /exists in multiple files/);
    assert.match(warnings[0], /intake-openapi\.yaml/);
    assert.match(warnings[0], /eligibility-openapi\.yaml/);
  });

  test('no match at all warns that the target exists nowhere', () => {
    const intake = apiSpec('domains/intake/intake-openapi.yaml');

    const { targets, warnings } = resolveActionTargets({ target: '$.webhooks', update: {} }, [intake]);

    assert.deepEqual(targets, []);
    assert.match(warnings[0], /does not exist in any file/);
  });

  test('an action with no target resolves to nothing, silently', () => {
    const { targets, warnings } = resolveActionTargets({ update: {} }, [apiSpec('a.yaml')]);

    assert.deepEqual(targets, []);
    assert.deepEqual(warnings, []);
  });
});

describe('resolveActionTargets — add actions', () => {
  test('an add matches on the parent path, since it creates the final segment', () => {
    const intake = apiSpec('domains/intake/intake-openapi.yaml');

    const { targets, warnings } = resolveActionTargets(
      { target: '$.paths./items/{id}/approve', add: { post: {} } },
      [intake]
    );

    assert.deepEqual(targets, [intake]);
    assert.deepEqual(warnings, []);
  });

  test('an add warns when the parent path is missing from the named file', () => {
    const intake = apiSpec('domains/intake/intake-openapi.yaml');

    const { targets, warnings } = resolveActionTargets(
      { target: '$.webhooks.onItemApproved', add: {}, file: 'domains/intake/intake-openapi.yaml' },
      [intake]
    );

    assert.deepEqual(targets, []);
    assert.match(warnings[0], /does not exist in specified file/);
  });
});
