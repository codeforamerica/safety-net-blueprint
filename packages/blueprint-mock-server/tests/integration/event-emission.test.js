/**
 * Event Emission Integration Tests
 *
 * Verifies that state machine actions emit domain events with the correct
 * CloudEvents 1.0 envelope, that emitted events are persisted and queryable
 * via GET /platform/events, and that events are delivered over the SSE stream.
 *
 * Run with: npm run test:integration
 */

import http from 'http';
import assert from 'assert';
import { BASE_URL, fetch, caller, createTestRunner } from './helpers.js';
import { ROLES } from '../roles.js';

const { test, section, results } = createTestRunner();

const APPLICANT = caller('applicant-1', ROLES.APPLICANT);
const SYSTEM = caller('system-1', ROLES.SYSTEM);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createApplication(programs = ['snap']) {
  const res = await fetch(`${BASE_URL}/intake/applications`, {
    method: 'POST',
    headers: APPLICANT,
    body: { programsAppliedFor: programs, channel: 'online' },
  });
  return res.json();
}

async function getEvents(afterId = null) {
  const url = afterId
    ? `${BASE_URL}/platform/events?limit=50&after=${afterId}`
    : `${BASE_URL}/platform/events?limit=50`;
  const res = await fetch(url);
  const body = await res.json();
  return body.items ?? [];
}

/**
 * Open an SSE connection to /platform/events/stream and collect events
 * emitted during the callback. Closes the connection when the callback resolves.
 *
 * @param {Function} fn - async function to run while the stream is open
 * @returns {Promise<Object[]>} - array of parsed CloudEvent objects received
 */
function withSseStream(fn) {
  return new Promise((resolve, reject) => {
    const collected = [];
    const urlObj = new URL(`${BASE_URL}/platform/events/stream`);

    const req = http.request({
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
    }, (res) => {
      let buffer = '';

      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try { collected.push(JSON.parse(line.slice(6))); } catch { /* ignore non-JSON */ }
          }
        }
      });

      res.on('error', reject);
    });

    req.on('error', reject);
    req.end();

    // Run the user's callback, then close the stream and return collected events
    fn().then(() => {
      req.destroy();
      resolve(collected);
    }).catch((err) => {
      req.destroy();
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

await fetch(`${BASE_URL}/mock/reset`, { method: 'POST' });

// ---------------------------------------------------------------------------
// CloudEvents envelope shape
// ---------------------------------------------------------------------------

section('Event envelope — CloudEvents 1.0 shape');

await test('emitted event has required CloudEvents fields', async () => {
  const app = await createApplication();
  const events = await getEvents();
  const event = events.find(e => e.subject === app.id);
  assert.ok(event, `No event found for application ${app.id}`);

  assert.equal(event.specversion, '1.0', 'specversion must be "1.0"');
  assert.ok(event.id, 'id must be present');
  assert.ok(event.type, 'type must be present');
  assert.ok(event.source, 'source must be present');
  assert.ok(event.subject, 'subject must be present');
  assert.ok(event.time, 'time must be present');
  assert.equal(event.datacontenttype, 'application/json', 'datacontenttype must be application/json');
});

await test('event type follows {domain}.{object}.{action} convention', async () => {
  const app = await createApplication();
  const events = await getEvents();
  const event = events.find(e => e.subject === app.id);
  assert.ok(event, `No event found for application ${app.id}`);

  // e.g. intake.application.opened — three dot-separated segments
  const parts = event.type.split('.');
  assert.ok(parts.length >= 3, `event type "${event.type}" must have at least 3 dot-separated segments`);
});

await test('event subject is the resource id', async () => {
  const app = await createApplication();
  const events = await getEvents();
  const event = events.find(e => e.subject === app.id);
  assert.ok(event, `No event for subject ${app.id}`);
  assert.equal(event.subject, app.id);
});

await test('event time is a valid ISO 8601 timestamp', async () => {
  const app = await createApplication();
  const events = await getEvents();
  const event = events.find(e => e.subject === app.id);
  assert.ok(event, `No event for subject ${app.id}`);
  assert.ok(!isNaN(Date.parse(event.time)), `time "${event.time}" must be a valid ISO 8601 timestamp`);
});

// ---------------------------------------------------------------------------
// State machine → event mapping
// ---------------------------------------------------------------------------

section('State machine actions → emitted events');

await test('POST /intake/applications emits an intake.application.* event', async () => {
  const app = await createApplication();
  const events = await getEvents();
  const event = events.find(e => e.subject === app.id && e.type.startsWith('intake.application.'));
  assert.ok(event, `Expected an intake.application.* event for application ${app.id}`);
});

await test('submitting an application emits intake.application.submitted', async () => {
  const app = await createApplication();
  await fetch(`${BASE_URL}/intake/applications/${app.id}/submit`, {
    method: 'POST',
    headers: APPLICANT,
  });

  const events = await getEvents();
  const submitted = events.find(e => e.subject === app.id && e.type === 'intake.application.submitted');
  assert.ok(submitted, `Expected intake.application.submitted event for application ${app.id}`);
});

await test('each transition emits a distinct event with a unique id', async () => {
  const app = await createApplication();
  await fetch(`${BASE_URL}/intake/applications/${app.id}/submit`, { method: 'POST', headers: APPLICANT });
  await fetch(`${BASE_URL}/intake/applications/${app.id}/open`, { method: 'POST', headers: SYSTEM });

  const events = await getEvents();
  const appEvents = events.filter(e => e.subject === app.id);
  const ids = appEvents.map(e => e.id);
  const uniqueIds = new Set(ids);
  assert.equal(uniqueIds.size, ids.length, 'each event must have a unique id');
});

// ---------------------------------------------------------------------------
// Persistence — GET /platform/events
// ---------------------------------------------------------------------------

section('Event persistence — GET /platform/events');

await test('emitted events are returned by GET /platform/events', async () => {
  const app = await createApplication();
  const events = await getEvents();
  assert.ok(Array.isArray(events), 'items must be an array');
  const event = events.find(e => e.subject === app.id);
  assert.ok(event, 'event for created resource must appear in /platform/events');
});

await test('GET /platform/events returns a paginated list response', async () => {
  const res = await fetch(`${BASE_URL}/platform/events?limit=5`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(body.items), 'items must be an array');
  assert.ok(typeof body.total === 'number', 'total must be a number');
  assert.ok(typeof body.hasNext === 'boolean', 'hasNext must be a boolean');
});

// ---------------------------------------------------------------------------
// SSE stream delivery
// ---------------------------------------------------------------------------

section('SSE stream — real-time event delivery');

await test('SSE connection receives : connected comment on open', async () => {
  const lines = await new Promise((resolve, reject) => {
    const collected = [];
    const urlObj = new URL(`${BASE_URL}/platform/events/stream`);
    const req = http.request({
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
    }, (res) => {
      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        // Collect lines until we see the connected comment then close
        if (buffer.includes(': connected')) {
          collected.push(...buffer.split('\n').filter(l => l.length > 0));
          req.destroy();
          resolve(collected);
        }
      });
    });
    req.on('error', (err) => {
      if (err.code === 'ECONNRESET') resolve(collected); // expected on destroy
      else reject(err);
    });
    setTimeout(() => { req.destroy(); resolve(collected); }, 2000);
    req.end();
  });

  assert.ok(lines.some(l => l.includes(': connected')), 'stream must send : connected comment on open');
});

await test('SSE stream delivers event emitted during connection', async () => {
  const received = await withSseStream(async () => {
    // Small delay to ensure stream is open before triggering
    await new Promise(r => setTimeout(r, 100));
    const app = await createApplication();
    await fetch(`${BASE_URL}/intake/applications/${app.id}/submit`, { method: 'POST', headers: APPLICANT });
    // Give the server time to flush the event
    await new Promise(r => setTimeout(r, 200));
    return app;
  });

  assert.ok(received.length > 0, 'SSE stream must deliver at least one event');
  assert.ok(
    received.some(e => e.type?.startsWith('intake.application.')),
    'SSE stream must deliver intake application event'
  );
});

await test('SSE event payload is a valid CloudEvents 1.0 envelope', async () => {
  const received = await withSseStream(async () => {
    await new Promise(r => setTimeout(r, 100));
    await createApplication();
    await new Promise(r => setTimeout(r, 200));
  });

  assert.ok(received.length > 0, 'must receive at least one event');
  const event = received[0];
  assert.equal(event.specversion, '1.0');
  assert.ok(event.id);
  assert.ok(event.type);
  assert.ok(event.source);
  assert.ok(event.subject);
  assert.ok(event.time);
});

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

const { passed, failed } = results();
process.exitCode = failed > 0 ? 1 : 0;
