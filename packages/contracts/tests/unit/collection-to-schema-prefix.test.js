/**
 * Unit test for collectionToSchemaPrefix in the OpenAPI loader.
 *
 * The function turns a kebab-case collection name into its PascalCase singular
 * schema prefix. The tricky part is singularizing the final segment: it must
 * strip a genuine plural 's' but leave non-plural words that happen to end in
 * 's' (progress, address, status, ...) intact.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { collectionToSchemaPrefix } from '../../src/validation/openapi-loader.js';

test('collectionToSchemaPrefix', async (t) => {
  await t.test('singularizes ordinary plural collections', () => {
    assert.strictEqual(collectionToSchemaPrefix('members'), 'Member');
    assert.strictEqual(collectionToSchemaPrefix('applications'), 'Application');
    assert.strictEqual(collectionToSchemaPrefix('categories'), 'Category');
    assert.strictEqual(collectionToSchemaPrefix('task-audit-events'), 'TaskAuditEvent');
  });

  await t.test('keeps non-plural words that end in s', () => {
    // 'progress' is not a plural, so the trailing s must survive.
    assert.strictEqual(
      collectionToSchemaPrefix('application-review-progress'),
      'ApplicationReviewProgress'
    );
    assert.strictEqual(collectionToSchemaPrefix('address'), 'Address');
    assert.strictEqual(collectionToSchemaPrefix('status'), 'Status');
    assert.strictEqual(collectionToSchemaPrefix('access'), 'Access');
    assert.strictEqual(collectionToSchemaPrefix('process'), 'Process');
  });
});
