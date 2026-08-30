/**
 * Unit tests for the overlay resolver.
 * Covers addAtPath and the add: action in applyOverlay.
 * Other overlay operations (update, remove, rename, replace, append) are
 * exercised indirectly through the resolve pipeline integration tests.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { addAtPath, applyOverlay } from '../../src/overlay/overlay-resolver.js';

// ---------------------------------------------------------------------------
// addAtPath
// ---------------------------------------------------------------------------

describe('addAtPath', () => {
  test('adds a key that does not exist', () => {
    const obj = { compositions: { reviewContext: { sections: { identity: {} } } } };
    const { added } = addAtPath(obj, '$.compositions.reviewContext.sections.household', { resource: 'household-info' });
    assert.equal(added, true);
    assert.deepEqual(obj.compositions.reviewContext.sections.household, { resource: 'household-info' });
  });

  test('returns already-exists reason when key is present', () => {
    const obj = { compositions: { reviewContext: { sections: { identity: { resource: 'members' } } } } };
    const { added, reason } = addAtPath(obj, '$.compositions.reviewContext.sections.identity', { resource: 'other' });
    assert.equal(added, false);
    assert.equal(reason, 'already exists');
    assert.equal(obj.compositions.reviewContext.sections.identity.resource, 'members');
  });

  test('returns reason when parent path does not exist', () => {
    const obj = { compositions: {} };
    const { added, reason } = addAtPath(obj, '$.compositions.reviewContext.sections.identity', {});
    assert.equal(added, false);
    assert.ok(reason.includes('reviewContext'));
  });

  test('does not auto-create intermediate keys', () => {
    const obj = { a: {} };
    const { added } = addAtPath(obj, '$.a.b.c.d', 'value');
    assert.equal(added, false);
    assert.equal(obj.a.b, undefined);
  });

  test('adds a top-level key when parent is root object', () => {
    const obj = { existing: 1 };
    const { added } = addAtPath(obj, '$.newKey', 'value');
    assert.equal(added, true);
    assert.equal(obj.newKey, 'value');
  });

  test('rejects filter as last segment', () => {
    const obj = { items: [{ id: 'a' }] };
    const { added, reason } = addAtPath(obj, '$.items[?(@.id == "x")]', { val: 1 });
    assert.equal(added, false);
    assert.ok(reason.includes('key'));
  });
});

// ---------------------------------------------------------------------------
// applyOverlay — add: action
// ---------------------------------------------------------------------------

describe('applyOverlay add: action', () => {
  function makeDoc() {
    return {
      compositions: {
        reviewContext: {
          compositeType: 'sectionView',
          sections: {
            identity: { resource: 'members', bind: 'applicationId' },
          },
        },
      },
    };
  }

  test('adds a new section via add: action', () => {
    const doc = makeDoc();
    const overlay = {
      overlay: '1.0.0',
      actions: [{
        target: '$.compositions.reviewContext.sections.household',
        description: 'Add household section',
        add: { resource: 'household-info', bind: 'applicationId' },
      }],
    };
    const { result, warnings } = applyOverlay(doc, overlay, { silent: true });
    assert.ok(result.compositions.reviewContext.sections.household);
    assert.equal(result.compositions.reviewContext.sections.household.resource, 'household-info');
    assert.equal(warnings.length, 0);
  });

  test('warns and skips when add: targets an existing key', () => {
    const doc = makeDoc();
    const overlay = {
      overlay: '1.0.0',
      actions: [{
        target: '$.compositions.reviewContext.sections.identity',
        description: 'Attempt to add identity (already exists)',
        add: { resource: 'other-resource', bind: 'applicationId' },
      }],
    };
    const { result, warnings } = applyOverlay(doc, overlay, { silent: true });
    assert.equal(result.compositions.reviewContext.sections.identity.resource, 'members');
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes('already exists'));
  });

  test('warns when parent path does not exist', () => {
    const doc = makeDoc();
    const overlay = {
      overlay: '1.0.0',
      actions: [{
        target: '$.compositions.nonExistent.sections.foo',
        description: 'Bad parent path',
        add: { resource: 'foo' },
      }],
    };
    const { warnings } = applyOverlay(doc, overlay, { silent: true });
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes('add:'));
  });

  test('does not emit path-not-found warning for add: targets', () => {
    const doc = makeDoc();
    const overlay = {
      overlay: '1.0.0',
      actions: [{
        target: '$.compositions.reviewContext.sections.newSection',
        description: 'Add new section',
        add: { resource: 'some-resource', bind: 'applicationId' },
      }],
    };
    const { result, warnings } = applyOverlay(doc, overlay, { silent: true });
    assert.ok(result.compositions.reviewContext.sections.newSection);
    const pathWarnings = warnings.filter(w => w.includes('does not exist in base schema'));
    assert.equal(pathWarnings.length, 0);
  });

  test('skips action when root key does not exist in document', () => {
    const doc = { otherKey: {} };
    const overlay = {
      overlay: '1.0.0',
      actions: [{
        target: '$.compositions.reviewContext.sections.foo',
        add: { resource: 'bar' },
      }],
    };
    const { result } = applyOverlay(doc, overlay, { silent: true });
    assert.deepEqual(result.otherKey, doc.otherKey);
    assert.equal(result.compositions, undefined);
  });
});
