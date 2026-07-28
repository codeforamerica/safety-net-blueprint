/**
 * Functional tests for x-derived field evaluation.
 *
 * Tests the full pipeline:
 *   OpenAPI fixture with x-derived annotation → mock server runtime CEL evaluation
 *   → field present and correctly computed in POST and GET responses
 *
 * Run via: node tests/run-all-tests.js --functional
 *
 * The server is started by the test runner before this file executes.
 * DO NOT start/stop the server in this file.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from './generated/typescript/x-derived/client/index.js';
import { createWidget, getWidget, listWidgets } from './generated/typescript/x-derived/sdk.gen.js';

const client = createClient({ baseURL: 'http://localhost:1080' });

let widgetId: string;

describe('Functional — x-derived: CEL field evaluation', () => {
  before(async () => {
    const res = await createWidget({ client, body: { label: 'test widget' } });
    assert.equal(res.status, 201, `expected 201, got ${res.status}`);
    widgetId = (res.data as { id: string }).id;
  });

  it('POST response includes widgetCode derived from id', async () => {
    const res = await createWidget({ client, body: { label: 'derived-check' } });
    assert.equal(res.status, 201);
    const data = res.data as { id: string; widgetCode: string };
    assert.ok(data.id, 'id must be present');
    assert.equal(data.widgetCode, data.id, 'widgetCode must equal id ($this.id)');
  });

  it('GET response includes widgetCode derived from id', async () => {
    const res = await getWidget({ client, path: { widgetId } });
    assert.equal(res.status, 200);
    const data = res.data as { id: string; widgetCode: string };
    assert.equal(data.widgetCode, data.id, 'widgetCode must equal id ($this.id)');
  });

  it('list response items all have widgetCode equal to id', async () => {
    const res = await listWidgets({ client });
    assert.equal(res.status, 200);
    const items = (res.data as { items: Array<{ id: string; widgetCode: string }> }).items;
    assert.ok(items.length > 0, 'at least one widget must exist');
    for (const item of items) {
      assert.equal(item.widgetCode, item.id, `widgetCode must equal id for widget ${item.id}`);
    }
  });
});
