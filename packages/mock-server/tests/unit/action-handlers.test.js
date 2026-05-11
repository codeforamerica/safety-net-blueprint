/**
 * Unit tests for action handlers
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { executeActions } from '../../src/action-handlers.js';

test('executeActions — handles null action gracefully', () => {
  const resource = { priority: 'normal' };
  executeActions(null, resource, {});
  assert.strictEqual(resource.priority, 'normal');
});

test('executeActions — skips unknown action types', () => {
  const resource = {};
  executeActions({ unknownAction: 'value' }, resource, {});
  assert.strictEqual(Object.keys(resource).length, 0);
});

// =============================================================================
// forEach
// =============================================================================

function makeForEachDeps(created) {
  return {
    context: {
      this: { id: 'event-1' },
      members: [
        { id: 'member-1', programs: ['snap'] },
        { id: 'member-2', programs: ['medicaid'] }
      ]
    },
    dbCreate(collection, fields) {
      const record = { id: `new-${created.length}`, ...fields };
      created.push({ collection, fields: { ...fields } });
      return record;
    },
    dbUpdate() {},
    findStateMachine: () => null,
    emitCreatedEvent: () => {}
  };
}

test('executeActions — forEach creates resource for each item in collection', () => {
  const created = [];
  executeActions(
    {
      forEach: {
        in: { var: 'members' },
        as: 'member',
        createResource: {
          entity: 'workflow/tasks',
          fields: { memberId: { var: 'member.id' }, status: 'pending' }
        }
      }
    },
    {},
    makeForEachDeps(created)
  );
  assert.strictEqual(created.length, 2);
  assert.strictEqual(created[0].fields.memberId, 'member-1');
  assert.strictEqual(created[1].fields.memberId, 'member-2');
});

test('executeActions — forEach filter excludes non-matching items', () => {
  const created = [];
  executeActions(
    {
      forEach: {
        in: { var: 'members' },
        as: 'member',
        filter: { in: ['snap', { var: 'member.programs' }] },
        createResource: {
          entity: 'workflow/tasks',
          fields: { memberId: { var: 'member.id' }, status: 'pending' }
        }
      }
    },
    {},
    makeForEachDeps(created)
  );
  // Only member-1 has snap
  assert.strictEqual(created.length, 1);
  assert.strictEqual(created[0].fields.memberId, 'member-1');
});

test('executeActions — forEach with empty collection executes no actions', () => {
  const created = [];
  const deps = { ...makeForEachDeps(created), context: { this: {}, members: [] } };
  executeActions(
    {
      forEach: {
        in: { var: 'members' },
        as: 'member',
        createResource: { entity: 'workflow/tasks', fields: { memberId: { var: 'member.id' } } }
      }
    },
    {},
    deps
  );
  assert.strictEqual(created.length, 0);
});
