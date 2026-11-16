/**
 * A record's SLA clocks start when it is created — through the API, or written
 * by a state machine's step — as the SLA types schema says (`autoAssignWhen`
 * is evaluated at creation; `startWhen` defaults to it).
 *
 * Run against the harness, whose SNAP SLA assigns itself to every application
 * for SNAP.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discover, load, generate } from '@codeforamerica/blueprint-core';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createMockServer } from '../../src/server.js';

// What an informing suggestion is about has to exist: Rosa, seeded in the harness.
const ROSA = '11111111-1111-4111-8111-100000000001';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const harness = resolve(packageRoot, '../blueprint-harness/generated/resolved');
const DAY = 24 * 60 * 60 * 1000;

/** The harness, with Suggestion actions that create an application directly — in a step, and in a procedure. */
function contracts() {
  const docs = discover(harness).map(load).map((doc) => {
    if (doc.type === 'state-machine' && doc.content?.domain === 'decision-support') {
      const [machine] = doc.content.machines;
      return {
        ...doc,
        content: {
          ...doc.content,
          machines: [{
            ...machine,
            actions: [...machine.actions, {
              id: 'open',
              transition: { from: 'proposed', to: 'proposed' },
              steps: [{ call: { POST: 'intake/applications', body: { programsAppliedFor: ['snap'], channel: 'online' } } }],
            }, {
              id: 'openLater',
              transition: { from: 'proposed', to: 'proposed' },
              steps: [{ call: 'openOne' }],
            }],
            procedures: [...(machine.procedures ?? []), {
              id: 'openOne',
              steps: [{ call: { POST: 'intake/applications', body: { programsAppliedFor: ['snap'], channel: 'online' } } }],
            }],
          }],
        },
      };
    }
    return doc;
  });
  return generate(docs, 'artifact');
}

let mock;
async function boot() {
  const log = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
  try { mock = await createMockServer({ contracts: contracts(), seed: true }); } finally { console.log = log; console.warn = warn; }
}

const send = async (method, path, body) => {
  const response = await mock.fetch(new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-caller-id': 'worker-1', 'x-caller-roles': 'worker' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

/** An slaInfo entry for snap_standard, started within the test, due in 30 days. */
function assertSnapClock(slaInfo, before) {
  assert.equal(slaInfo?.length, 1, JSON.stringify(slaInfo));
  const [clock] = slaInfo;
  assert.equal(clock.slaTypeCode, 'snap_standard');
  assert.equal(clock.status, 'active');
  const started = Date.parse(clock.clockStartedAt);
  assert.ok(started >= before && started <= Date.now());
  assert.equal(Date.parse(clock.deadline) - started, 30 * DAY);
}

test('an application created through the API starts the SLA clocks that assign themselves to it', async () => {
  await boot();
  const before = Date.now();
  const { status, body } = await send('POST', '/intake/applications', { programsAppliedFor: ['snap'], channel: 'online' });
  assert.equal(status, 201, JSON.stringify(body));
  assertSnapClock(body.slaInfo, before);
  const [created] = (await send('GET', '/platform/events?type=intake.application.created')).body.items
    .filter((e) => e.subject === body.id);
  assertSnapClock(created.data.slaInfo, before);
});

test('one no SLA assigns itself to gets no clocks', async () => {
  await boot();
  const { status, body } = await send('POST', '/intake/applications', { programsAppliedFor: ['medicaid'], channel: 'online' });
  assert.equal(status, 201, JSON.stringify(body));
  assert.equal(body.slaInfo, undefined);
});

test('an application a state machine\'s step creates directly starts its clocks too', async () => {
  await boot();
  const { body: suggestion } = await send('POST', '/decision-support/suggestions', {
    kind: 'informing', subjectType: 'application_member', subjectId: ROSA, category: 'name-mismatch',
  });
  const before = Date.now();
  assert.equal((await send('POST', `/decision-support/suggestions/${suggestion.id}/open`, {})).status, 200);
  const { body: list } = await send('GET', '/intake/applications?limit=100');
  const opened = list.items.filter((a) => Date.parse(a.createdAt) >= before);
  assert.equal(opened.length, 1);
  assertSnapClock(opened[0].slaInfo, before);
});

test('one a procedure creates directly starts its clocks and sends its created event, as whoever ran the action', async () => {
  await boot();
  const { body: suggestion } = await send('POST', '/decision-support/suggestions', {
    kind: 'informing', subjectType: 'application_member', subjectId: ROSA, category: 'name-mismatch',
  });
  const before = Date.now();
  assert.equal((await send('POST', `/decision-support/suggestions/${suggestion.id}/openLater`, {})).status, 200);
  const { body: list } = await send('GET', '/intake/applications?limit=100');
  const opened = list.items.filter((a) => Date.parse(a.createdAt) >= before);
  assert.equal(opened.length, 1);
  assertSnapClock(opened[0].slaInfo, before);
  const created = (await send('GET', '/platform/events?type=intake.application.created')).body.items
    .filter((e) => e.subject === opened[0].id);
  assert.equal(created.length, 1, 'one created event');
  assert.equal(created[0].authid, 'worker-1');
  assertSnapClock(created[0].data.slaInfo, before);
});

test('a created application\'s slaInfo, in its response and its created event, matches the SlaInfo contract', async () => {
  // Defined in base/schemas/sla.yaml; base/components/sla.yaml refers to it.
  const { SlaInfo } = yaml.load(readFileSync(resolve(harness, 'base/schemas/sla.yaml'), 'utf8')).$defs;
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const matches = ajv.compile({ type: 'array', items: SlaInfo });

  await boot();
  const { body } = await send('POST', '/intake/applications', { programsAppliedFor: ['snap'], channel: 'online' });
  assert.ok(matches(body.slaInfo), JSON.stringify(matches.errors));
  const { body: read } = await send('GET', `/intake/applications/${body.id}`);
  assert.ok(matches(read.slaInfo), JSON.stringify(matches.errors));
  const { body: list } = await send('GET', '/intake/applications?limit=100');
  assert.ok(matches(list.items.find((a) => a.id === body.id).slaInfo), JSON.stringify(matches.errors));
  const [created] = (await send('GET', '/platform/events?type=intake.application.created')).body.items
    .filter((e) => e.subject === body.id);
  assert.ok(matches(created.data.slaInfo), JSON.stringify(matches.errors));

  // Kept where the engine needs them, to pause and resume the clock.
  const stored = mock.store.findById('applications', body.id);
  assert.ok('_accumulatedPausedMs' in stored.slaInfo[0]);
});
