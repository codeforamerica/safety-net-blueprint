/**
 * Collection naming must agree between core and the mock server.
 *
 * `generate(docs, 'examples')` groups example records by collection; the mock
 * server names its databases by collection. If the two derive different names
 * for the same path, records are grouped under keys no database has and
 * seeding silently produces nothing — no error, just empty collections.
 *
 * They did diverge: core joined the segments (`applications-members`) while
 * the server singularizes the parent (`application-members`). The server's is
 * the correct one, because a collection name has to round-trip to the schema
 * it holds — `application-members` gives `ApplicationMember`, a real schema
 * whose examples are keyed `ApplicationMemberExample1`. `ApplicationsMember`
 * exists nowhere, so every example would fail to match.
 *
 * This lives here rather than in core because only this package can import
 * both.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '@codeforamerica/blueprint-core';
import { deriveCollectionName } from '../../src/collection-utils.js';

/** The collections core derives for a set of paths. */
function coreCollections(paths) {
  const doc = {
    type: 'openapi',
    path: '/contracts/intake-openapi.yaml',
    relativePath: 'intake-openapi.yaml',
    domain: 'intake',
    content: { openapi: '3.1.0', info: { title: 'Intake', version: '1' }, paths },
    refs: () => new Map(),
    model: () => null,
    resolved: false,
    provenance: null,
  };
  return Object.keys(generate([doc], 'examples')).sort();
}

const PATHS = [
  '/applications',
  '/applications/{applicationId}/members',
  '/applications/{applicationId}/documents',
  '/applications/{applicationId}/interview',
  '/applications/{applicationId}/household-info',
  '/tasks/{taskId}/audit-events',
  '/application',
];

describe('collection naming parity', () => {
  test('core and the mock server derive the same collection for every path shape', () => {
    const fromServer = [...new Set(PATHS.map((p) => deriveCollectionName(p, '')))].sort();
    assert.deepEqual(coreCollections(Object.fromEntries(PATHS.map((p) => [p, {}]))), fromServer);
  });

  test('a sub-collection takes its parent in the singular', () => {
    // The specific divergence that caused this. Guarded by name so a
    // regression says what broke rather than just failing a set comparison.
    assert.deepEqual(coreCollections({ '/applications/{applicationId}/members': {} }), [
      'application-members',
    ]);
    assert.equal(deriveCollectionName('/applications/{applicationId}/members', ''), 'application-members');
  });

  test('a singleton sub-resource keeps its singular name', () => {
    assert.deepEqual(coreCollections({ '/applications/{applicationId}/interview': {} }), ['interview']);
    assert.equal(deriveCollectionName('/applications/{applicationId}/interview', ''), 'interview');
  });

  test('a top-level singleton is pluralized', () => {
    assert.deepEqual(coreCollections({ '/application': {} }), ['applications']);
    assert.equal(deriveCollectionName('/application', ''), 'applications');
  });
});
