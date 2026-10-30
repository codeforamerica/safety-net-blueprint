/**
 * Unit tests for the overlay resolver.
 * Covers addAtPath, the add: action in applyOverlay, and the target syntax:
 * dotted names, filters, index selectors and quoted names.
 * Other overlay operations (update, remove, rename, replace, append) are
 * exercised indirectly through the resolve pipeline integration tests.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { addAtPath, applyOverlay, parsePath, formatPath } from '../../../src/overlay/overlay-resolver.js';

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

// ---------------------------------------------------------------------------
// Target syntax
// ---------------------------------------------------------------------------

describe('overlay targets', () => {
  const machine = () => ({
    machines: [
      { object: 'Determination', emits: [{ id: 'complete', description: 'base' }, { id: 'reopened', description: 'base' }] },
      { object: 'Decision', emits: [{ id: 'issued', description: 'base' }] },
    ],
  });
  const rules = () => ({
    rulesets: {
      review: {
        outputs: { 'risks.cashIncome': {}, 'reviewMonths[].qualifies': {}, plain: {} },
        constants: { 'odd]key': { value: 1 } },
      },
    },
  });
  const apply = (doc, action) => applyOverlay(doc, { actions: [action] }, { silent: true });

  test('an index selects an item of a list, counting from the end when negative', () => {
    const { result, warnings } = apply(machine(), { target: '$.machines[0].emits[1].description', update: 'first machine, second event' });
    assert.deepEqual(warnings, []);
    assert.equal(result.machines[0].emits[1].description, 'first machine, second event');
    const last = apply(machine(), { target: '$.machines[-1].emits[0].description', update: 'last machine' }).result;
    assert.equal(last.machines[1].emits[0].description, 'last machine');
  });

  test('an index past the end of the list is reported missing, and changes nothing', () => {
    const { result, warnings } = apply(machine(), { target: '$.machines[5].object', update: 'Nothing' });
    assert.match(warnings[0], /machines\[5\]/);
    assert.equal(result.machines.length, 2);
  });

  test('an index can remove an item', () => {
    const { result } = apply(machine(), { target: '$.machines[0].emits[0]', remove: true });
    assert.deepEqual(result.machines[0].emits.map((e) => e.id), ['reopened']);
  });

  test('a quoted name matches a key with a dot or brackets in it', () => {
    for (const [target, key] of [
      ["$.rulesets.review.outputs['risks.cashIncome']", 'risks.cashIncome'],
      ['$.rulesets.review.outputs["reviewMonths[].qualifies"]', 'reviewMonths[].qualifies'],
      ["$.rulesets.review.constants['odd]key'].value", null],
    ]) {
      const { result, warnings } = apply(rules(), { target, remove: true });
      assert.deepEqual(warnings, [], target);
      if (key) assert.equal(key in result.rulesets.review.outputs, false, target);
      else assert.equal(result.rulesets.review.constants['odd]key'].value, undefined, target);
    }
  });

  test('a quoted name can be followed by more of the path', () => {
    const { result } = apply(rules(), { target: "$.rulesets.review.outputs['risks.cashIncome'].description", update: 'Cash income' });
    assert.equal(result.rulesets.review.outputs['risks.cashIncome'].description, 'Cash income');
  });

  test('filters work as before', () => {
    const { result } = apply(machine(), { target: "$.machines[?(@.object=='Determination')].emits[?(@.id=='complete')].description", update: 'filtered' });
    assert.equal(result.machines[0].emits[0].description, 'filtered');
  });

  test('syntax overlays don\'t support is an error naming the target, not a target that matches nothing', () => {
    for (const target of ['$.machines[*].object', '$..object', '$.machines[0:2]', '$.machines[]', "$.machines[?(@.a > 1)]", "$.rulesets.review.outputs['unclosed]"]) {
      assert.throws(() => apply(machine(), { target, update: 'x' }), (err) => err.message.includes(target), target);
    }
  });

  test('a target reads back as written', () => {
    for (const target of [
      '$.machines[0].emits[-1].description',
      "$.rulesets.review.outputs['risks.cashIncome']",
      "$.machines[?(@.object == 'Determination')].emits",
    ]) assert.equal(formatPath(parsePath(target)), target);
  });
});
