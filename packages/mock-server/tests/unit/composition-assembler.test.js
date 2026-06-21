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
  deriveStateResource,
  findStateRecord,
  listStateRecords,
  upsertStateRecord,
  toExpressPath,
} from '../../src/composition-assembler.js';
import { extractPrimaryParam } from '../../src/collection-utils.js';

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
// assembleSectionIndex — index views
// ---------------------------------------------------------------------------

const INDEX_VIEW_COMPOSITION = {
  compositeType: 'sectionView',
  resource: 'applications',
  endpoint: { path: '/applications/{applicationId}/review' },
  sections: {
    members: {
      resource: 'application-members',
      bind: 'applicationId',
      index: {
        filter: "roles.contains('primary_applicant')",
        fields: ['id', 'firstName', 'lastName'],
      },
    },
    household: {
      resource: 'household-infos',
      bind: 'applicationId',
      missing: 'empty',
      index: {
        fields: ['id'],
      },
    },
    noView: {
      resource: 'application-members',
      bind: 'applicationId',
    },
  },
  panel: {},
};

describe('assembleSectionIndex — index views', () => {
  beforeEach(() => {
    clearAll('application-members');
    clearAll('household-infos');
    insertResource('application-members', {
      id: MEMBER_ID_1, applicationId: APP_ID,
      firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com',
      roles: ['primary_applicant'],
    });
    insertResource('application-members', {
      id: MEMBER_ID_2, applicationId: APP_ID,
      firstName: 'Bob', lastName: 'Jones', email: 'bob@example.com',
      roles: ['household_member'],
    });
  });

  test('section with index view returns filtered and projected items', () => {
    const result = assembleSectionIndex(
      INDEX_VIEW_COMPOSITION,
      { applicationId: APP_ID },
      '/applications/:applicationId/review'
    );
    const membersSection = result.sections.find(s => s.name === 'members');
    assert.ok(Array.isArray(membersSection.items));
    assert.strictEqual(membersSection.items.length, 1, 'should filter to primary_applicant only');
    assert.strictEqual(membersSection.items[0].firstName, 'Alice');
    assert.ok(!('email' in membersSection.items[0]), 'projected fields should exclude email');
  });

  test('section without index view has no items in index entry', () => {
    const result = assembleSectionIndex(
      INDEX_VIEW_COMPOSITION,
      { applicationId: APP_ID },
      '/applications/:applicationId/review'
    );
    const noViewSection = result.sections.find(s => s.name === 'noView');
    assert.ok(!('items' in noViewSection));
  });

  test('section with missing: empty and no records returns data: {}', () => {
    const result = assembleSectionIndex(
      INDEX_VIEW_COMPOSITION,
      { applicationId: APP_ID },
      '/applications/:applicationId/review'
    );
    const householdSection = result.sections.find(s => s.name === 'household');
    assert.deepStrictEqual(householdSection.data, {});
  });
});

// ---------------------------------------------------------------------------
// assembleSectionIndex — root-level fields: projection
// ---------------------------------------------------------------------------

const FIELDS_COMPOSITION = {
  compositeType: 'sectionView',
  resource: 'applications',
  fields: ['programs', 'status'],
  endpoint: { path: '/applications/{applicationId}/review' },
  sections: {
    demographics: {
      resource: 'application-members',
      bind: 'applicationId',
      index: { fields: ['id', 'firstName'] },
    },
  },
};

describe('assembleSectionIndex — root-level fields: projection', () => {
  beforeEach(() => {
    clearAll('applications');
    clearAll('application-members');
    insertResource('applications', {
      id: APP_ID,
      programs: ['snap', 'medicaid'],
      status: 'submitted',
      internalFlag: 'secret',
    });
    insertResource('application-members', {
      id: MEMBER_ID_1,
      applicationId: APP_ID,
      firstName: 'Alice',
      lastName: 'Smith',
    });
  });

  test('merges declared root fields from the parent resource into the response', () => {
    const result = assembleSectionIndex(
      FIELDS_COMPOSITION,
      { applicationId: APP_ID },
      '/applications/:applicationId/review'
    );
    assert.deepStrictEqual(result.programs, ['snap', 'medicaid']);
    assert.strictEqual(result.status, 'submitted');
  });

  test('does not include undeclared fields from the parent resource', () => {
    const result = assembleSectionIndex(
      FIELDS_COMPOSITION,
      { applicationId: APP_ID },
      '/applications/:applicationId/review'
    );
    assert.ok(!('internalFlag' in result), 'undeclared fields must not appear in the response');
    assert.ok(!('id' in result), 'id is not in the declared fields list so it must not appear');
  });

  test('sections are still present alongside the root fields', () => {
    const result = assembleSectionIndex(
      FIELDS_COMPOSITION,
      { applicationId: APP_ID },
      '/applications/:applicationId/review'
    );
    assert.ok(Array.isArray(result.sections), 'sections must still be present');
    assert.strictEqual(result.sections.length, 1);
  });

  test('returns only sections when composition has no fields declaration', () => {
    const noFieldsComposition = { ...FIELDS_COMPOSITION, fields: undefined };
    const result = assembleSectionIndex(
      noFieldsComposition,
      { applicationId: APP_ID },
      '/applications/:applicationId/review'
    );
    assert.ok(!('programs' in result));
    assert.ok(!('status' in result));
    assert.ok(Array.isArray(result.sections));
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
// deriveStateResource
// ---------------------------------------------------------------------------

describe('deriveStateResource', () => {
  test('returns null when stateConfig is missing', () => {
    assert.strictEqual(deriveStateResource(null), null);
    assert.strictEqual(deriveStateResource({}), null);
    assert.strictEqual(deriveStateResource({ schema: {} }), null);
  });

  test('derives pathSegment, collectionName, camelKey, defsKey from $ref with endpoint context', () => {
    const result = deriveStateResource(
      { schema: { $ref: './schemas/intake-compositions-schemas.yaml#/$defs/ReviewProgress' } },
      '/applications/{applicationId}/review',
      '/intake'
    );
    assert.deepStrictEqual(result, {
      defsKey: 'ReviewProgress',
      pathSegment: 'review-progress',
      collectionName: 'application-review-progress',
      camelKey: 'reviewProgress',
    });
  });

  test('falls back to pathSegment as collectionName when no endpointPath given', () => {
    const result = deriveStateResource({
      schema: { $ref: './schemas/intake-compositions-schemas.yaml#/$defs/ReviewProgress' },
    });
    assert.deepStrictEqual(result, {
      defsKey: 'ReviewProgress',
      pathSegment: 'review-progress',
      collectionName: 'review-progress',
      camelKey: 'reviewProgress',
    });
  });

  test('handles single-word key', () => {
    const result = deriveStateResource({
      schema: { $ref: './schemas/foo.yaml#/$defs/Status' },
    });
    assert.strictEqual(result.defsKey, 'Status');
    assert.strictEqual(result.pathSegment, 'status');
    assert.strictEqual(result.camelKey, 'status');
  });

  test('returns null for malformed $ref (no $defs segment)', () => {
    const result = deriveStateResource({
      schema: { $ref: './schemas/foo.yaml#/components/schemas/Foo' },
    });
    assert.strictEqual(result, null);
  });
});

// ---------------------------------------------------------------------------
// State CRUD: upsertStateRecord / findStateRecord / listStateRecords
// ---------------------------------------------------------------------------

describe('state CRUD helpers', () => {
  const COLL = 'test-progress';
  const BIND_PARAM = 'applicationId';
  const BIND_VALUE = 'app-state-001';

  beforeEach(() => clearAll(COLL));

  test('upsertStateRecord creates a new record', () => {
    const record = upsertStateRecord(COLL, BIND_PARAM, BIND_VALUE, 'identity', null, { status: 'not_started' });
    assert.ok(record.id, 'has id');
    assert.strictEqual(record[BIND_PARAM], BIND_VALUE);
    assert.strictEqual(record.section, 'identity');
    assert.strictEqual(record.status, 'not_started');
    assert.ok(!record.itemId, 'no itemId for singleton');
    assert.ok(record.createdAt, 'has createdAt');
    assert.ok(record.updatedAt, 'has updatedAt');
  });

  test('upsertStateRecord creates a record with itemId for collection-backed sections', () => {
    const record = upsertStateRecord(COLL, BIND_PARAM, BIND_VALUE, 'identity', 'mem-001', { status: 'in_progress' });
    assert.strictEqual(record.itemId, 'mem-001');
    assert.strictEqual(record.section, 'identity');
    assert.strictEqual(record.status, 'in_progress');
  });

  test('upsertStateRecord updates an existing record on second call', () => {
    const first = upsertStateRecord(COLL, BIND_PARAM, BIND_VALUE, 'household', null, { status: 'not_started' });
    const second = upsertStateRecord(COLL, BIND_PARAM, BIND_VALUE, 'household', null, { status: 'complete' });
    assert.strictEqual(first.id, second.id, 'same record');
    assert.strictEqual(second.status, 'complete');
  });

  test('upsertStateRecord with itemId updates the correct record', () => {
    upsertStateRecord(COLL, BIND_PARAM, BIND_VALUE, 'identity', 'mem-001', { status: 'not_started' });
    upsertStateRecord(COLL, BIND_PARAM, BIND_VALUE, 'identity', 'mem-002', { status: 'not_started' });
    const updated = upsertStateRecord(COLL, BIND_PARAM, BIND_VALUE, 'identity', 'mem-001', { status: 'in_progress' });
    assert.strictEqual(updated.status, 'in_progress');

    const other = findStateRecord(COLL, BIND_PARAM, BIND_VALUE, 'identity', 'mem-002');
    assert.strictEqual(other.status, 'not_started', 'other record untouched');
  });

  test('findStateRecord returns null when record does not exist', () => {
    const result = findStateRecord(COLL, BIND_PARAM, BIND_VALUE, 'income', null);
    assert.strictEqual(result, null);
  });

  test('findStateRecord retrieves the correct record by section + itemId', () => {
    upsertStateRecord(COLL, BIND_PARAM, BIND_VALUE, 'identity', 'mem-001', { status: 'complete' });
    const found = findStateRecord(COLL, BIND_PARAM, BIND_VALUE, 'identity', 'mem-001');
    assert.strictEqual(found.status, 'complete');
  });

  test('listStateRecords returns paginated result for a section', () => {
    upsertStateRecord(COLL, BIND_PARAM, BIND_VALUE, 'identity', 'mem-001', { status: 'in_progress' });
    upsertStateRecord(COLL, BIND_PARAM, BIND_VALUE, 'identity', 'mem-002', { status: 'not_started' });
    const result = listStateRecords(COLL, BIND_PARAM, BIND_VALUE, 'identity');
    assert.strictEqual(result.total, 2);
    assert.strictEqual(result.items.length, 2);
    assert.ok('hasNext' in result && 'limit' in result && 'offset' in result, 'pagination fields present');
  });

  test('listStateRecords returns empty result for an unknown section', () => {
    const result = listStateRecords(COLL, BIND_PARAM, BIND_VALUE, 'nonexistent');
    assert.strictEqual(result.total, 0);
    assert.deepStrictEqual(result.items, []);
  });
});

// ---------------------------------------------------------------------------
// assembleSectionPanel — state embedding
// ---------------------------------------------------------------------------

describe('assembleSectionPanel — state embedding', () => {
  // collection name is derived from the endpoint path: /applications/{applicationId}/review-progress → application-review-progress
  const STATE_COLL = 'application-review-progress';

  const STATE_COMPOSITION = {
    compositeType: 'sectionView',
    resource: 'applications',
    endpoint: { path: '/applications/{applicationId}/review' },
    state: {
      schema: { $ref: './schemas/test-compositions-schemas.yaml#/$defs/ReviewProgress' },
    },
    sections: {
      demographics: {
        resource: 'application-members',
        bind: 'applicationId',
      },
    },
  };

  beforeEach(() => {
    clearAll('application-members');
    clearAll(STATE_COLL);
    insertResource('application-members', { id: MEMBER_ID_1, applicationId: APP_ID, firstName: 'Alice' });
    insertResource('application-members', { id: MEMBER_ID_2, applicationId: APP_ID, firstName: 'Bob' });
  });

  test('embeds state from DB under camelKey when record exists', () => {
    upsertStateRecord(STATE_COLL, 'applicationId', APP_ID, 'demographics', MEMBER_ID_1, { status: 'complete' });
    const panel = assembleSectionPanel(STATE_COMPOSITION, 'demographics', { applicationId: APP_ID });
    const alice = panel.items.find(i => i.id === MEMBER_ID_1);
    assert.ok(alice.reviewProgress, 'reviewProgress present on item');
    assert.strictEqual(alice.reviewProgress.status, 'complete');
  });

  test('uses stateDefaults when no record exists', () => {
    const defaults = { status: 'not_started' };
    const panel = assembleSectionPanel(STATE_COMPOSITION, 'demographics', { applicationId: APP_ID }, defaults);
    for (const item of panel.items) {
      assert.deepStrictEqual(item.reviewProgress, { status: 'not_started' });
    }
  });

  test('embeds empty object when no record and no defaults', () => {
    const panel = assembleSectionPanel(STATE_COMPOSITION, 'demographics', { applicationId: APP_ID });
    for (const item of panel.items) {
      assert.deepStrictEqual(item.reviewProgress, {});
    }
  });

  test('strips framework fields from embedded state', () => {
    upsertStateRecord(STATE_COLL, 'applicationId', APP_ID, 'demographics', MEMBER_ID_1, { status: 'in_progress' });
    const panel = assembleSectionPanel(STATE_COMPOSITION, 'demographics', { applicationId: APP_ID });
    const alice = panel.items.find(i => i.id === MEMBER_ID_1);
    assert.ok(!('id' in alice.reviewProgress), 'no id');
    assert.ok(!('createdAt' in alice.reviewProgress), 'no createdAt');
    assert.ok(!('updatedAt' in alice.reviewProgress), 'no updatedAt');
    assert.ok(!('applicationId' in alice.reviewProgress), 'no applicationId');
    assert.ok(!('section' in alice.reviewProgress), 'no section');
    assert.ok(!('itemId' in alice.reviewProgress), 'no itemId');
  });
});
