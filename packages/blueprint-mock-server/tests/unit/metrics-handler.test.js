/**
 * Metrics are computed from what the store holds — all of it, read from the
 * store the handler was given.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { createMemoryStore } from '../../src/stores/memory-store.js';
import { createMetricsGetHandler } from '../../src/handlers/metrics-handler.js';

const metrics = [{
  domain: 'intake',
  metrics: [{
    id: 'applications_submitted',
    name: 'Applications Submitted',
    aggregate: 'count',
    source: { collection: 'events', filter: { '==': [{ var: 'type' }, 'intake.application.submitted'] } },
  }],
}];

const valueOf = async (store, query = '') => {
  const handler = createMetricsGetHandler(metrics, { store });
  const response = await handler(new Request(`http://localhost/workflow/metrics/applications_submitted${query}`),
    { params: { metricId: 'applications_submitted' } });
  return (await response.json()).value;
};

const submitted = (n, time) => ({ id: `e${n}`, type: 'intake.application.submitted', time });

test('counts the events in the store it was given', async () => {
  const store = createMemoryStore();
  store.append('events', submitted(1, '2024-01-01T00:00:00Z'));
  store.append('events', { id: 'other', type: 'intake.application.closed', time: '2024-01-01T00:00:00Z' });
  assert.strictEqual(await valueOf(store), 1);
});

test('counts every record, not one page of them', async () => {
  const store = createMemoryStore();
  for (let n = 0; n < 30; n++) store.append('events', submitted(n, '2024-01-01T00:00:00Z'));
  assert.strictEqual(await valueOf(store), 30);
});

test('windows events by when they happened', async () => {
  const store = createMemoryStore();
  store.append('events', submitted(1, '2024-01-01T00:00:00Z'));
  store.append('events', submitted(2, '2024-03-01T00:00:00Z'));
  assert.strictEqual(await valueOf(store, '?from=2024-02-01T00:00:00Z'), 1);
});

const compute = async (definition, store) => {
  const handler = createMetricsGetHandler([{ domain: 'intake', metrics: [definition] }], { store });
  const response = await handler(new Request(`http://localhost/workflow/metrics/${definition.id}`),
    { params: { metricId: definition.id } });
  return response.json();
};

test('a duration pairs events by the record they are about', async () => {
  const store = createMemoryStore();
  const event = (id, type, subject, time) => store.append('events', { id, type, subject, time });
  event('s1', 'intake.application.submitted', 'app-1', '2024-01-01T00:00:00Z');
  event('c1', 'intake.application.closed', 'app-1', '2024-01-03T00:00:00Z');
  event('s2', 'intake.application.submitted', 'app-2', '2024-01-01T00:00:00Z');
  event('c2', 'intake.application.closed', 'app-2', '2024-01-05T00:00:00Z');

  const result = await compute({
    id: 'processing_time',
    name: 'Processing time',
    aggregate: 'duration',
    from: { collection: 'events', filter: { '==': [{ var: 'type' }, 'intake.application.submitted'] } },
    to: { collection: 'events', filter: { '==': [{ var: 'type' }, 'intake.application.closed'] } },
  }, store);

  // Two days and four days, paired by subject with no pairBy given: a median of three days, in seconds.
  assert.strictEqual(result.value, 3 * 24 * 60 * 60);
});

test('a filter can ask whether any entry of a list matches', async () => {
  const store = createMemoryStore();
  store.insertResource('applications', { id: 'a', slaInfo: [{ status: 'running' }, { status: 'breached' }] });
  store.insertResource('applications', { id: 'b', slaInfo: [{ status: 'running' }] });

  const result = await compute({
    id: 'breach_rate',
    name: 'Breach rate',
    aggregate: 'ratio',
    source: { collection: 'applications', filter: { some: [{ var: 'slaInfo' }, { '==': [{ var: 'status' }, 'breached'] }] } },
    total: { collection: 'applications' },
  }, store);

  assert.strictEqual(result.value, 0.5);
});

test('a breakdown groups any collection the metric names', async () => {
  const store = createMemoryStore();
  store.insertResource('applications', { id: 'a', county: 'north', status: 'withdrawn' });
  store.insertResource('applications', { id: 'b', county: 'north', status: 'submitted' });
  store.insertResource('applications', { id: 'c', county: 'south', status: 'submitted' });

  const handler = createMetricsGetHandler([{ domain: 'intake', metrics: [{
    id: 'withdrawal_rate',
    name: 'Withdrawal rate',
    aggregate: 'ratio',
    source: { collection: 'applications', filter: { '==': [{ var: 'status' }, 'withdrawn'] } },
    total: { collection: 'applications' },
  }] }], { store });
  const response = await handler(new Request('http://localhost/workflow/metrics/withdrawal_rate?groupBy=county'),
    { params: { metricId: 'withdrawal_rate' } });

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual((await response.json()).breakdown, { north: 0.5, south: 0 });
});
