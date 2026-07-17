/**
 * Unit tests for validate-sla-metrics.js
 *
 * Tests validateSlaTypes, validateMetrics, extractVarFields, and buildCollectionSchemaMap.
 * Smoke tests run real SLA/metrics files against real OpenAPI specs.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  validateSlaTypes,
  validateMetrics,
  extractVarFields,
  buildCollectionSchemaMap,
} from '../../scripts/validate-sla-metrics.js';
import { collectTopLevelProperties } from '../../src/validation/state-machine-validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const contractsRoot = join(__dirname, '../../');

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
// Smoke tests — real SLA/metrics files against real OpenAPI specs
// ---------------------------------------------------------------------------

describe('smoke tests — real SLA types and metrics files', () => {
  test('workflow-sla-types.yaml var: fields resolve against workflow-openapi.yaml', async () => {
    const { readFileSync } = await import('fs');
    const yaml = (await import('js-yaml')).default;

    let doc;
    try {
      doc = yaml.load(readFileSync(join(contractsRoot, 'workflow-sla-types.yaml'), 'utf8'));
    } catch {
      return;
    }

    const collectionMap = buildCollectionSchemaMap(contractsRoot);
    const errors = validateSlaTypes(doc, collectionMap);

    assert.deepEqual(
      errors,
      [],
      `SLA validation errors:\n${errors.map(e => `  [${e.slaTypeId}] ${e.message}`).join('\n')}`
    );
  });

  test('workflow-metrics.yaml var: fields resolve against workflow-openapi.yaml', async () => {
    const { readFileSync } = await import('fs');
    const yaml = (await import('js-yaml')).default;

    let doc;
    try {
      doc = yaml.load(readFileSync(join(contractsRoot, 'workflow-metrics.yaml'), 'utf8'));
    } catch {
      return;
    }

    const collectionMap = buildCollectionSchemaMap(contractsRoot);
    const errors = validateMetrics(doc, collectionMap);

    assert.deepEqual(
      errors,
      [],
      `Metrics validation errors:\n${errors.map(e => `  [${e.metricId}] ${e.message}`).join('\n')}`
    );
  });
});
