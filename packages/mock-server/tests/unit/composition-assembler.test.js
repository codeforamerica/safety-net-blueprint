/**
 * Unit tests for composition-assembler.
 *
 * Tests assembleSectionIndex, assembleSectionPanel, and filter evaluation
 * using in-memory database-manager state.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { clearAll, insertResource } from '../../src/database-manager.js';
import {
  assembleSectionIndex,
  assembleSectionPanel,
  extractPrimaryParam,
  toExpressPath,
} from '../../src/composition-assembler.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const APP_ID = 'app-001';
const MEMBER_ID_1 = 'mem-001';
const MEMBER_ID_2 = 'mem-002';

const SIMPLE_COMPOSITION = {
  compositeType: 'sectionView',
  resource: 'applications',
  endpoint: { path: '/applications/{applicationId}/review' },
  sections: {
    demographics: {
      resource: 'application-members',
      bind: 'applicationId',
    },
    identity: {
      resource: 'application-members',
      bind: 'applicationId',
      include: {
        verifications: {
          resource: 'verifications',
          bind: 'applicationId',
          filter: "category == 'identity'",
        },
      },
    },
    contact: {
      resource: 'application-members',
      bind: 'applicationId',
      fields: ['id', 'firstName', 'lastName'],
    },
    household: {
      resource: 'household-infos',
      bind: 'applicationId',
      missing: 'empty',
    },
  },
  panel: {
    include: {
      notes: {
        resource: 'application-notes',
        bind: 'applicationId',
      },
      verifications: {
        resource: 'verifications',
        bind: 'applicationId',
        filter: "category == $section.name",
      },
    },
  },
};

function seedTestData() {
  clearAll('application-members');
  clearAll('verifications');
  clearAll('application-notes');
  clearAll('household-infos');

  insertResource('application-members', { id: MEMBER_ID_1, applicationId: APP_ID, firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com' });
  insertResource('application-members', { id: MEMBER_ID_2, applicationId: APP_ID, firstName: 'Bob', lastName: 'Jones', email: 'bob@example.com' });

  insertResource('verifications', { id: 'ver-001', applicationId: APP_ID, category: 'identity', status: 'pending' });
  insertResource('verifications', { id: 'ver-002', applicationId: APP_ID, category: 'income', status: 'pending' });

  insertResource('application-notes', { id: 'note-001', applicationId: APP_ID, text: 'First note' });
}

// ---------------------------------------------------------------------------
// toExpressPath
// ---------------------------------------------------------------------------

describe('toExpressPath', () => {
  test('converts {param} to :param', () => {
    assert.strictEqual(
      toExpressPath('/applications/{applicationId}/review'),
      '/applications/:applicationId/review'
    );
  });

  test('handles multiple params', () => {
    assert.strictEqual(
      toExpressPath('/applications/{applicationId}/members/{memberId}'),
      '/applications/:applicationId/members/:memberId'
    );
  });

  test('leaves paths with no params unchanged', () => {
    assert.strictEqual(toExpressPath('/applications'), '/applications');
  });
});

// ---------------------------------------------------------------------------
// extractPrimaryParam
// ---------------------------------------------------------------------------

describe('extractPrimaryParam', () => {
  test('returns the last path param', () => {
    assert.strictEqual(extractPrimaryParam('/applications/{applicationId}/review'), 'applicationId');
  });

  test('returns null for paths with no params', () => {
    assert.strictEqual(extractPrimaryParam('/applications'), null);
  });
});

// ---------------------------------------------------------------------------
// assembleSectionIndex
// ---------------------------------------------------------------------------

describe('assembleSectionIndex', () => {
  test('returns all section names as href links', () => {
    const result = assembleSectionIndex(
      SIMPLE_COMPOSITION,
      { applicationId: APP_ID },
      '/applications/:applicationId/review'
    );
    assert.ok(Array.isArray(result.sections));
    assert.strictEqual(result.sections.length, 4);
    const names = result.sections.map(s => s.name);
    assert.ok(names.includes('demographics'));
    assert.ok(names.includes('identity'));
    assert.ok(names.includes('contact'));
    assert.ok(names.includes('household'));
  });

  test('resolves path params in hrefs', () => {
    const result = assembleSectionIndex(
      SIMPLE_COMPOSITION,
      { applicationId: APP_ID },
      '/applications/:applicationId/review'
    );
    for (const section of result.sections) {
      assert.ok(section.href.includes(APP_ID), `href should contain applicationId: ${section.href}`);
      assert.ok(section.href.endsWith(`/${section.name}`), `href should end with section name: ${section.href}`);
    }
  });
});

// ---------------------------------------------------------------------------
// assembleSectionPanel — bind resolution
// ---------------------------------------------------------------------------

describe('assembleSectionPanel — bind resolution', () => {
  beforeEach(seedTestData);

  test('demographics section returns application members', () => {
    const result = assembleSectionPanel(SIMPLE_COMPOSITION, 'demographics', { applicationId: APP_ID });
    assert.ok(result, 'should return a panel');
    assert.strictEqual(result.section, 'demographics');
    assert.ok(Array.isArray(result.items));
    assert.strictEqual(result.items.length, 2);
  });

  test('only returns members for the given applicationId', () => {
    insertResource('application-members', { id: 'mem-other', applicationId: 'other-app', firstName: 'Other', lastName: 'Person' });
    const result = assembleSectionPanel(SIMPLE_COMPOSITION, 'demographics', { applicationId: APP_ID });
    assert.strictEqual(result.items.length, 2);
    for (const item of result.items) {
      assert.strictEqual(item.applicationId, APP_ID);
    }
  });
});

// ---------------------------------------------------------------------------
// assembleSectionPanel — filter evaluation
// ---------------------------------------------------------------------------

describe('assembleSectionPanel — filter evaluation', () => {
  beforeEach(seedTestData);

  test('identity section include filters verifications by category == identity', () => {
    const result = assembleSectionPanel(SIMPLE_COMPOSITION, 'identity', { applicationId: APP_ID });
    assert.ok(result.include?.verifications, 'should have verifications include');
    assert.strictEqual(result.include.verifications.length, 1);
    assert.strictEqual(result.include.verifications[0].category, 'identity');
  });

  test('panel verifications filter uses $section.name substitution', () => {
    // demographics section: panel.include.verifications filters category == 'demographics'
    // No verifications with that category exist → empty array
    const result = assembleSectionPanel(SIMPLE_COMPOSITION, 'demographics', { applicationId: APP_ID });
    assert.ok(result.include?.verifications, 'should have panel verifications');
    assert.strictEqual(result.include.verifications.length, 0);
  });

  test('section include takes precedence over panel include for same key', () => {
    // identity section has its own verifications include (filtered to identity only)
    // panel also has verifications (filtered to $section.name == identity, same result here)
    // Section-level include should win (it is processed first)
    const result = assembleSectionPanel(SIMPLE_COMPOSITION, 'identity', { applicationId: APP_ID });
    // Should only have identity category verifications
    assert.strictEqual(result.include.verifications.length, 1);
    assert.strictEqual(result.include.verifications[0].id, 'ver-001');
  });
});

// ---------------------------------------------------------------------------
// assembleSectionPanel — field selection
// ---------------------------------------------------------------------------

describe('assembleSectionPanel — field selection', () => {
  beforeEach(seedTestData);

  test('contact section projects only declared fields', () => {
    const result = assembleSectionPanel(SIMPLE_COMPOSITION, 'contact', { applicationId: APP_ID });
    assert.ok(result.items.length > 0);
    for (const item of result.items) {
      const keys = Object.keys(item);
      assert.ok(keys.includes('id'));
      assert.ok(keys.includes('firstName'));
      assert.ok(keys.includes('lastName'));
      assert.ok(!keys.includes('email'), 'email should be projected out');
    }
  });
});

// ---------------------------------------------------------------------------
// assembleSectionPanel — missing: empty
// ---------------------------------------------------------------------------

describe('assembleSectionPanel — missing: empty', () => {
  beforeEach(seedTestData);

  test('household section returns empty object when no records found', () => {
    // No household-infos seeded for APP_ID — should get empty object not 404
    const result = assembleSectionPanel(SIMPLE_COMPOSITION, 'household', { applicationId: APP_ID });
    assert.ok(result, 'should return a panel');
    assert.strictEqual(result.section, 'household');
    assert.deepStrictEqual(result.data, {});
    assert.ok(!result.items, 'should use data not items when missing: empty');
  });
});

// ---------------------------------------------------------------------------
// assembleSectionPanel — panel includes
// ---------------------------------------------------------------------------

describe('assembleSectionPanel — panel includes', () => {
  beforeEach(seedTestData);

  test('every section includes panel notes', () => {
    const result = assembleSectionPanel(SIMPLE_COMPOSITION, 'demographics', { applicationId: APP_ID });
    assert.ok(result.include?.notes, 'should have notes include');
    assert.strictEqual(result.include.notes.length, 1);
    assert.strictEqual(result.include.notes[0].text, 'First note');
  });
});

// ---------------------------------------------------------------------------
// assembleSectionPanel — unknown section
// ---------------------------------------------------------------------------

describe('assembleSectionPanel — unknown section', () => {
  test('returns null for unknown section name', () => {
    const result = assembleSectionPanel(SIMPLE_COMPOSITION, 'nonexistent', { applicationId: APP_ID });
    assert.strictEqual(result, null);
  });
});

// ---------------------------------------------------------------------------
// assembleSectionPanel — derived fields
// ---------------------------------------------------------------------------

const DERIVE_COMPOSITION = {
  compositeType: 'sectionView',
  resource: 'applications',
  endpoint: { path: '/applications/{applicationId}/review' },
  derives: {
    isComplete: {
      item: "Object.values($self).every(v => $present(v))",
      collection: "items.length > 0 && items.every(i => Object.values(i).every(v => $present(v)))",
    },
    percentComplete: {
      item: "Object.keys($self).length === 0 ? 0 : Math.round(Object.values($self).filter(v => $present(v)).length / Object.keys($self).length * 100)",
      collection: "items.length === 0 ? 0 : Math.round(items.filter(i => Object.values(i).every(v => $present(v))).length / items.length * 100)",
    },
    countComplete: {
      item: "({ complete: Object.values($self).filter(v => $present(v)).length, total: Object.keys($self).length })",
      collection: "({ complete: items.filter(i => Object.values(i).every(v => $present(v))).length, total: items.length })",
    },
  },
  sections: {
    demographics: {
      resource: 'application-members',
      bind: 'applicationId',
      fields: ['firstName', 'lastName', 'dateOfBirth'],
      derive: {
        complete: { $ref: '#/derives/isComplete/item' },
        allComplete: { $ref: '#/derives/isComplete/collection' },
        percent: { $ref: '#/derives/percentComplete/item' },
        collectionPercent: { $ref: '#/derives/percentComplete/collection' },
        counts: { $ref: '#/derives/countComplete/item' },
        collectionCounts: { $ref: '#/derives/countComplete/collection' },
      },
    },
    sparse: {
      resource: 'application-members',
      bind: 'applicationId',
      derive: {
        hasPhone: "has(phoneNumber)",
      },
    },
  },
  panel: {},
};

describe('assembleSectionPanel — derived fields', () => {
  beforeEach(() => {
    clearAll('application-members');
    // Alice: all three declared fields present
    insertResource('application-members', { id: MEMBER_ID_1, applicationId: APP_ID, firstName: 'Alice', lastName: 'Smith', dateOfBirth: '1990-01-01' });
    // Bob: missing dateOfBirth
    insertResource('application-members', { id: MEMBER_ID_2, applicationId: APP_ID, firstName: 'Bob', lastName: 'Jones', dateOfBirth: null });
  });

  test('item-scope complete: true when all declared fields present', () => {
    const result = assembleSectionPanel(DERIVE_COMPOSITION, 'demographics', { applicationId: APP_ID });
    const alice = result.items.find(i => i.firstName === 'Alice');
    assert.strictEqual(alice.complete, true);
  });

  test('item-scope complete: false when a declared field is missing', () => {
    const result = assembleSectionPanel(DERIVE_COMPOSITION, 'demographics', { applicationId: APP_ID });
    const bob = result.items.find(i => i.firstName === 'Bob');
    assert.strictEqual(bob.complete, false);
  });

  test('item-scope percentComplete: 100 when all fields present', () => {
    const result = assembleSectionPanel(DERIVE_COMPOSITION, 'demographics', { applicationId: APP_ID });
    const alice = result.items.find(i => i.firstName === 'Alice');
    assert.strictEqual(alice.percent, 100);
  });

  test('item-scope percentComplete: partial when some fields missing', () => {
    const result = assembleSectionPanel(DERIVE_COMPOSITION, 'demographics', { applicationId: APP_ID });
    const bob = result.items.find(i => i.firstName === 'Bob');
    assert.ok(bob.percent > 0 && bob.percent < 100);
  });

  test('item-scope countComplete returns { complete, total }', () => {
    const result = assembleSectionPanel(DERIVE_COMPOSITION, 'demographics', { applicationId: APP_ID });
    const alice = result.items.find(i => i.firstName === 'Alice');
    assert.deepStrictEqual(alice.counts, { complete: 3, total: 3 });
    const bob = result.items.find(i => i.firstName === 'Bob');
    assert.strictEqual(bob.counts.total, 3);
    assert.ok(bob.counts.complete < 3);
  });

  test('collection-scope allComplete: false when any item incomplete', () => {
    const result = assembleSectionPanel(DERIVE_COMPOSITION, 'demographics', { applicationId: APP_ID });
    assert.strictEqual(result.allComplete, false);
  });

  test('collection-scope allComplete: true when all items complete', () => {
    clearAll('application-members');
    insertResource('application-members', { id: MEMBER_ID_1, applicationId: APP_ID, firstName: 'Alice', lastName: 'Smith', dateOfBirth: '1990-01-01' });
    const result = assembleSectionPanel(DERIVE_COMPOSITION, 'demographics', { applicationId: APP_ID });
    assert.strictEqual(result.allComplete, true);
  });

  test('collection-scope percentComplete: partial when some items incomplete', () => {
    const result = assembleSectionPanel(DERIVE_COMPOSITION, 'demographics', { applicationId: APP_ID });
    assert.ok(result.collectionPercent > 0 && result.collectionPercent < 100);
  });

  test('collection-scope countComplete returns { complete, total }', () => {
    const result = assembleSectionPanel(DERIVE_COMPOSITION, 'demographics', { applicationId: APP_ID });
    assert.strictEqual(result.collectionCounts.total, 2);
    assert.strictEqual(result.collectionCounts.complete, 1);
  });

  test('collection-scope fields do not appear on individual items', () => {
    const result = assembleSectionPanel(DERIVE_COMPOSITION, 'demographics', { applicationId: APP_ID });
    for (const item of result.items) {
      assert.ok(!('allComplete' in item));
      assert.ok(!('collectionPercent' in item));
      assert.ok(!('collectionCounts' in item));
    }
  });

  test('item-scope derive on absent field returns false', () => {
    const result = assembleSectionPanel(DERIVE_COMPOSITION, 'sparse', { applicationId: APP_ID });
    for (const item of result.items) {
      assert.strictEqual(typeof item.hasPhone, 'boolean');
    }
  });

  test('empty collection: allComplete is false, percentComplete is 0, countComplete total is 0', () => {
    clearAll('application-members');
    const result = assembleSectionPanel(DERIVE_COMPOSITION, 'demographics', { applicationId: APP_ID });
    assert.strictEqual(result.allComplete, false);
    assert.strictEqual(result.collectionPercent, 0);
    assert.deepStrictEqual(result.collectionCounts, { complete: 0, total: 0 });
  });
});
