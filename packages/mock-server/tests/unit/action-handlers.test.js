/**
 * Unit tests for action handlers
 * Tests action execution, queue assignment, and priority setting
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { executeActions } from '../../src/action-handlers.js';

// =============================================================================
// setPriority
// =============================================================================

test('executeActions — setPriority sets priority field', () => {
  const resource = {};
  executeActions({ setPriority: 'expedited' }, resource, {});
  assert.strictEqual(resource.priority, 'expedited');
});

test('executeActions — setPriority overwrites existing priority', () => {
  const resource = { priority: 'low' };
  executeActions({ setPriority: 'high' }, resource, {});
  assert.strictEqual(resource.priority, 'high');
});

// =============================================================================
// assignToQueue
// =============================================================================

test('executeActions — assignToQueue sets queueId from looked-up queue', () => {
  const resource = {};
  const deps = {
    findByField: (collection, field, value) => {
      if (collection === 'queues' && field === 'name' && value === 'snap-intake') {
        return { id: 'queue-uuid-1', name: 'snap-intake' };
      }
      return null;
    }
  };
  executeActions({ assignToQueue: 'snap-intake' }, resource, deps);
  assert.strictEqual(resource.queueId, 'queue-uuid-1');
});

test('executeActions — assignToQueue uses fallback when queue not found', () => {
  const resource = {};
  const deps = {
    findByField: (collection, field, value) => {
      if (value === 'general-intake') {
        return { id: 'queue-uuid-2', name: 'general-intake' };
      }
      return null;
    }
  };
  const fallbackAction = { assignToQueue: 'general-intake' };
  executeActions({ assignToQueue: 'nonexistent' }, resource, deps, fallbackAction);
  assert.strictEqual(resource.queueId, 'queue-uuid-2');
});

test('executeActions — assignToQueue does nothing when queue and fallback not found', () => {
  const resource = {};
  const deps = {
    findByField: () => null
  };
  executeActions({ assignToQueue: 'nonexistent' }, resource, deps);
  assert.strictEqual(resource.queueId, undefined);
});

// =============================================================================
// Multiple actions
// =============================================================================

test('executeActions — processes multiple actions in one call', () => {
  const resource = {};
  const deps = {
    findByField: (collection, field, value) => {
      if (value === 'snap-intake') {
        return { id: 'queue-uuid-1', name: 'snap-intake' };
      }
      return null;
    }
  };
  executeActions({ assignToQueue: 'snap-intake', setPriority: 'expedited' }, resource, deps);
  assert.strictEqual(resource.queueId, 'queue-uuid-1');
  assert.strictEqual(resource.priority, 'expedited');
});

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
