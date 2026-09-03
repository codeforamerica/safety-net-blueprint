/**
 * Unit tests for validate-sla-metrics.js
 *
 * Tests validateSlaTypes, validateMetrics, extractVarFields, and buildCollectionSchemaMap.
 * Smoke tests run real SLA/metrics files against real OpenAPI specs.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  validateSlaTypes,
  validateMetrics,
  extractVarFields,
  buildCollectionSchemaMap,
} from '../scripts/validate/sla-metrics.js';
import { collectTopLevelProperties } from '@codeforamerica/blueprint-core/state-machine-validator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCollectionMap(collections = {}) {
  // collections: { collectionName → [fieldName, ...] }
  const map = new Map();
  for (const [collection, fields] of Object.entries(collections)) {
    const spec = {
      components: {
        schemas: {
          Resource: {
            type: 'object',
            properties: Object.fromEntries(fields.map(f => [f, { type: 'string' }])),
          },
        },
      },
    };
    map.set(collection, {
      spec,
      properties: collectTopLevelProperties(spec, spec.components.schemas.Resource),
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// extractVarFields
// ---------------------------------------------------------------------------

describe('extractVarFields', () => {
  test('extracts var: string from {var: "status"} object', () => {
    const fields = extractVarFields({ var: 'status' });
    assert.deepEqual(fields, ['status']);
  });

  test('extracts var: from nested filter expression', () => {
    const filter = { '==': [{ var: 'status' }, 'pending'] };
    assert.deepEqual(extractVarFields(filter), ['status']);
  });

  test('extracts var: from in: expression array', () => {
    // pauseWhen.in: [{ var: "status" }, [...values]]
    const pauseWhen = { in: [{ var: 'status' }, ['awaiting_client', 'awaiting_verification']] };
    const fields = extractVarFields(pauseWhen);
    assert.ok(fields.includes('status'));
  });

  test('extracts multiple var: fields', () => {
    const filter = { and: [{ '==': [{ var: 'status' }, 'a'] }, { '==': [{ var: 'action' }, 'b'] }] };
    const fields = extractVarFields(filter);
    assert.ok(fields.includes('status'));
    assert.ok(fields.includes('action'));
  });

  test('returns empty array for non-object input', () => {
    assert.deepEqual(extractVarFields(null), []);
    assert.deepEqual(extractVarFields('string'), []);
    assert.deepEqual(extractVarFields([]), []);
  });
});

// ---------------------------------------------------------------------------
// validateSlaTypes
// ---------------------------------------------------------------------------

describe('validateSlaTypes', () => {
  const collectionMap = makeCollectionMap({
    tasks: ['status', 'assignedToId', 'createdAt'],
  });

  test('passes when var: status exists on Task schema', () => {
    const doc = {
      slaTypes: [{
        id: 'snap_expedited',
        pauseWhen: { in: [{ var: 'status' }, ['awaiting_client', 'awaiting_verification']] },
      }],
    };
    assert.deepEqual(validateSlaTypes(doc, collectionMap), []);
  });

  test('errors when var: references a field not on Task schema', () => {
    const doc = {
      slaTypes: [{
        id: 'snap_expedited',
        pauseWhen: { in: [{ var: 'nonExistentField' }, ['a', 'b']] },
      }],
    };
    const errors = validateSlaTypes(doc, collectionMap);
    assert.ok(errors.length > 0);
    assert.ok(errors[0].message.includes('nonExistentField'));
  });

  test('passes with empty slaTypes array', () => {
    assert.deepEqual(validateSlaTypes({ slaTypes: [] }, collectionMap), []);
  });

  test('passes when no Task schema is available (skips validation)', () => {
    const doc = {
      slaTypes: [{
        id: 'snap_expedited',
        pauseWhen: { in: [{ var: 'nonExistentField' }, []] },
      }],
    };
    // No 'tasks' in the collection map — should skip silently
    assert.deepEqual(validateSlaTypes(doc, new Map()), []);
  });
});

// ---------------------------------------------------------------------------
// validateMetrics
// ---------------------------------------------------------------------------

describe('validateMetrics', () => {
  const collectionMap = makeCollectionMap({
    tasks: ['status', 'assignedToId', 'createdAt', 'slaInfo'],
    applications: ['status', 'programsAppliedFor'],
  });

  test('passes when source.filter var: is a known field', () => {
    const doc = {
      metrics: [{
        id: 'tasks_in_queue',
        source: { collection: 'tasks', filter: { '==': [{ var: 'status' }, 'pending'] } },
      }],
    };
    assert.deepEqual(validateMetrics(doc, collectionMap), []);
  });

  test('errors when source.filter var: is unknown', () => {
    const doc = {
      metrics: [{
        id: 'bad_metric',
        source: { collection: 'tasks', filter: { '==': [{ var: 'nonExistent' }, 'x'] } },
      }],
    };
    const errors = validateMetrics(doc, collectionMap);
    assert.ok(errors.length > 0);
    assert.ok(errors[0].message.includes('nonExistent'));
  });

  test('passes for from.filter var: on known field', () => {
    const doc = {
      metrics: [{
        id: 'time_metric',
        from: { collection: 'tasks', filter: { '==': [{ var: 'status' }, 'pending'] } },
        to: { collection: 'tasks', filter: { '==': [{ var: 'status' }, 'completed'] } },
      }],
    };
    assert.deepEqual(validateMetrics(doc, collectionMap), []);
  });

  test('skips validation for events collection (not in OpenAPI)', () => {
    const doc = {
      metrics: [{
        id: 'event_metric',
        from: { collection: 'events', filter: { '==': [{ var: 'action' }, 'created'] } },
        to: { collection: 'events', filter: { '==': [{ var: 'action' }, 'completed'] } },
      }],
    };
    // events collection not in map — should produce no errors
    assert.deepEqual(validateMetrics(doc, collectionMap), []);
  });

  test('passes with empty metrics array', () => {
    assert.deepEqual(validateMetrics({ metrics: [] }, collectionMap), []);
  });
});

// ---------------------------------------------------------------------------
// Scenario tests — simulate overlay changes; assert validator catches stale var: refs
// ---------------------------------------------------------------------------

describe('scenario: field rename in SLA — overlay renames status → taskStatus', () => {
  // Resolved spec after the rename: tasks schema no longer has "status"
  const collectionMap = makeCollectionMap({
    tasks: ['taskStatus', 'assignedToId', 'createdAt'],
  });

  test('catches stale var: status in pauseWhen (old field name)', () => {
    const doc = {
      slaTypes: [{
        id: 'snap_expedited',
        pauseWhen: { in: [{ var: 'status' }, ['awaiting_client']] },
      }],
    };
    const errors = validateSlaTypes(doc, collectionMap);
    assert.ok(errors.length > 0 && errors[0].message.includes('status'),
      `Expected error for stale field "status" but got: ${JSON.stringify(errors)}`);
  });

  test('passes with var: taskStatus (updated field name)', () => {
    const doc = {
      slaTypes: [{
        id: 'snap_expedited',
        pauseWhen: { in: [{ var: 'taskStatus' }, ['awaiting_client']] },
      }],
    };
    assert.deepEqual(validateSlaTypes(doc, collectionMap), []);
  });
});

describe('scenario: field rename in metrics — overlay renames status → taskStatus', () => {
  const collectionMap = makeCollectionMap({
    tasks: ['taskStatus', 'assignedToId', 'createdAt'],
  });

  test('catches stale var: status in filter (old field name)', () => {
    const doc = {
      metrics: [{
        id: 'tasks_in_queue',
        source: { collection: 'tasks', filter: { '==': [{ var: 'status' }, 'pending'] } },
      }],
    };
    const errors = validateMetrics(doc, collectionMap);
    assert.ok(errors.length > 0 && errors[0].message.includes('status'),
      `Expected error for stale field "status" but got: ${JSON.stringify(errors)}`);
  });

  test('passes with var: taskStatus in filter (updated field name)', () => {
    const doc = {
      metrics: [{
        id: 'tasks_in_queue',
        source: { collection: 'tasks', filter: { '==': [{ var: 'taskStatus' }, 'pending'] } },
      }],
    };
    assert.deepEqual(validateMetrics(doc, collectionMap), []);
  });
});

// ---------------------------------------------------------------------------
// buildCollectionSchemaMap — fixture-based tests
// ---------------------------------------------------------------------------

describe('buildCollectionSchemaMap — with fixture specs', () => {
  test('builds a map from a directory with a known OpenAPI spec', async () => {
    const { mkdtempSync, writeFileSync, mkdirSync } = await import('fs');
    const { join: pathJoin } = await import('path');
    const { tmpdir } = await import('os');
    const yaml = (await import('js-yaml')).default;

    const tmpDir = mkdtempSync(pathJoin(tmpdir(), 'snb-sla-test-'));
    mkdirSync(pathJoin(tmpDir, 'tasks'));
    writeFileSync(pathJoin(tmpDir, 'tasks', 'tasks-openapi.yaml'), yaml.dump({
      openapi: '3.1.0',
      info: { title: 'Tasks API', version: '1.0.0', 'x-api-id': 'tasks' },
      servers: [{ url: '/' }],
      paths: {
        '/tasks': { get: { operationId: 'listTasks', responses: {} } },
        '/tasks/{taskId}': { get: { operationId: 'getTask', responses: {} } },
      },
      components: {
        schemas: {
          Task: {
            type: 'object',
            required: ['id', 'status', 'createdAt'],
            properties: {
              id: { type: 'string', format: 'uuid', readOnly: true },
              status: { type: 'string' },
              assignedToId: { type: 'string' },
              createdAt: { type: 'string', format: 'date-time', readOnly: true },
            },
          },
        },
      },
    }));

    const collectionMap = buildCollectionSchemaMap(tmpDir);
    assert.ok(collectionMap.has('tasks'), 'should have tasks collection');
    const entry = collectionMap.get('tasks');
    assert.ok(entry.properties.status, 'should include status field');
    assert.ok(entry.properties.createdAt, 'should include createdAt field');
  });

  test('SLA types validate correctly against fixture collection map', async () => {
    const collectionMap = makeCollectionMap({ tasks: ['status', 'assignedToId', 'createdAt'] });
    const doc = {
      slaTypes: [{
        id: 'fixture_sla',
        pauseWhen: { in: [{ var: 'status' }, ['paused', 'on_hold']] },
      }],
    };
    assert.deepEqual(validateSlaTypes(doc, collectionMap), []);
  });

  test('metrics validate correctly against fixture collection map', async () => {
    const collectionMap = makeCollectionMap({
      tasks: ['status', 'assignedToId', 'createdAt'],
    });
    const doc = {
      metrics: [{
        id: 'fixture_metric',
        from: { collection: 'tasks', filter: { '==': [{ var: 'status' }, 'open'] } },
        to: { collection: 'tasks', filter: { '==': [{ var: 'status' }, 'closed'] } },
      }],
    };
    assert.deepEqual(validateMetrics(doc, collectionMap), []);
  });
});
