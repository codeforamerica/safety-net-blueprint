/**
 * Unit test for collectionToSchemaPrefix in the OpenAPI loader.
 *
 * The function turns a kebab-case collection name into its PascalCase singular
 * schema prefix. Singularizing the final segment is the tricky part: it has to
 * strip a genuine plural ending without touching words that merely end in 's',
 * and handle the irregular forms too.
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

  await t.test('keeps words that only look plural', () => {
    // 'progress' is not a plural, so the trailing s has to survive
    assert.strictEqual(
      collectionToSchemaPrefix('application-review-progress'),
      'ApplicationReviewProgress'
    );
    assert.strictEqual(collectionToSchemaPrefix('address'), 'Address');
    assert.strictEqual(collectionToSchemaPrefix('status'), 'Status');
    assert.strictEqual(collectionToSchemaPrefix('access'), 'Access');
    assert.strictEqual(collectionToSchemaPrefix('process'), 'Process');
  });

  await t.test('handles -es plurals of words ending in s', () => {
    // /cases is a real endpoint whose schemas are Case, CaseCreate, CaseList
    assert.strictEqual(collectionToSchemaPrefix('cases'), 'Case');
    assert.strictEqual(collectionToSchemaPrefix('statuses'), 'Status');
    assert.strictEqual(collectionToSchemaPrefix('addresses'), 'Address');
    assert.strictEqual(collectionToSchemaPrefix('processes'), 'Process');
  });

  await t.test('handles irregular plurals', () => {
    assert.strictEqual(collectionToSchemaPrefix('people'), 'Person');
    assert.strictEqual(collectionToSchemaPrefix('children'), 'Child');
    assert.strictEqual(collectionToSchemaPrefix('criteria'), 'Criterion');
  });

  await t.test('only singularizes the final segment', () => {
    assert.strictEqual(collectionToSchemaPrefix('documents-links'), 'DocumentsLink');
    assert.strictEqual(collectionToSchemaPrefix('service-calls'), 'ServiceCall');
  });
});
