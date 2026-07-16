/**
 * Functional tests for x-relationship behavior: expand and links-only.
 *
 * Tests the full pipeline:
 *   raw OpenAPI fixture → resolve.js (relationship transform) → hey-api codegen
 *   → mock server runtime expand / links population → zod validation
 *
 * Run via: node tests/run-all-tests.js --functional
 *
 * The server is started by the test runner before this file executes.
 * DO NOT start/stop the server in this file.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from './generated/typescript/x-relationship/client/index.js';
import {
  createOwner,
  createParent,
  createChild,
  getParent,
  getChild,
  listParents,
  listChildren,
  updateParent,
  updateChild,
} from './generated/typescript/x-relationship/sdk.gen.js';
import {
  zParent,
  zChild,
  zParentUpdate,
  zChildUpdate,
} from './generated/typescript/x-relationship/zod.gen.js';

const client = createClient({ baseURL: 'http://localhost:1080' });

// IDs shared across tests within the describe block (set in before hook)
let fullOwnerId: string;
let minOwnerId: string;
let fullParentId: string;
let minParentId: string;
let fullChildId: string;
let minChildId: string;

describe('Functional — x-relationship: expand and links-only', () => {
  before(async () => {
    // Create two Owners: one with all fields, one with only required fields
    const fullOwnerRes = await createOwner({
      client,
      body: { label: 'Full Owner', note: 'owner note value' },
    });
    assert.equal(fullOwnerRes.status, 201, 'createOwner (full) must return 201');
    fullOwnerId = (fullOwnerRes.data as { id: string }).id;

    const minOwnerRes = await createOwner({
      client,
      body: { label: 'Minimal Owner' },
    });
    assert.equal(minOwnerRes.status, 201, 'createOwner (minimal) must return 201');
    minOwnerId = (minOwnerRes.data as { id: string }).id;

    // Create two Parents: one with all fields (linked to fullOwner), one minimal (linked to minOwner)
    const fullParentRes = await createParent({
      client,
      body: { name: 'Full Parent', description: 'parent description', ownerId: fullOwnerId },
    });
    assert.equal(fullParentRes.status, 201, 'createParent (full) must return 201');
    fullParentId = (fullParentRes.data as { id: string }).id;

    const minParentRes = await createParent({
      client,
      body: { name: 'Minimal Parent', ownerId: minOwnerId },
    });
    assert.equal(minParentRes.status, 201, 'createParent (minimal) must return 201');
    minParentId = (minParentRes.data as { id: string }).id;

    // Create two Children: one with all fields (linked to fullParent), one minimal (linked to minParent)
    const fullChildRes = await createChild({
      client,
      body: { label: 'Full Child', note: 'child note value', parentId: fullParentId },
    });
    assert.equal(fullChildRes.status, 201, 'createChild (full) must return 201');
    fullChildId = (fullChildRes.data as { id: string }).id;

    const minChildRes = await createChild({
      client,
      body: { label: 'Minimal Child', parentId: minParentId },
    });
    assert.equal(minChildRes.status, 201, 'createChild (minimal) must return 201');
    minChildId = (minChildRes.data as { id: string }).id;
  });

  // ---------------------------------------------------------------------------
  // Expand tests: GET Parent (ownerId → expanded owner object)
  // ---------------------------------------------------------------------------

  it('GET full parent — owner field is an object, not a UUID string', async () => {
    const res = await getParent({ client, path: { parentId: fullParentId } });
    assert.equal(res.status, 200);
    const parent = res.data as Record<string, unknown>;
    assert.equal(typeof parent.owner, 'object', 'owner must be an object');
    assert.notEqual(typeof parent.owner, 'string', 'owner must not be a string UUID');
  });

  it('GET full parent — ownerId field is ABSENT (replaced by expand)', async () => {
    const res = await getParent({ client, path: { parentId: fullParentId } });
    const parent = res.data as Record<string, unknown>;
    assert.equal(parent.ownerId, undefined, 'ownerId must not be present when expand is active');
  });

  it('GET full parent — owner.id, owner.label, owner.createdAt, owner.updatedAt all present', async () => {
    const res = await getParent({ client, path: { parentId: fullParentId } });
    const owner = (res.data as { owner: Record<string, unknown> }).owner;
    assert.ok(owner.id, 'owner.id must be present');
    assert.equal(typeof owner.id, 'string', 'owner.id must be a string');
    assert.ok(owner.label, 'owner.label must be present');
    assert.equal(typeof owner.label, 'string', 'owner.label must be a string');
    assert.ok(owner.createdAt, 'owner.createdAt must be present');
    assert.ok(owner.updatedAt, 'owner.updatedAt must be present');
  });

  it('GET full parent — owner.note is present with correct value', async () => {
    const res = await getParent({ client, path: { parentId: fullParentId } });
    const owner = (res.data as { owner: Record<string, unknown> }).owner;
    assert.equal(owner.note, 'owner note value', 'owner.note must match the value set on creation');
  });

  it('GET min parent — owner.note is absent without zod error', async () => {
    const res = await getParent({ client, path: { parentId: minParentId } });
    const owner = (res.data as { owner: Record<string, unknown> }).owner;
    assert.equal(owner.note, undefined, 'owner.note must be absent for minimal owner');
    assert.doesNotThrow(() => zParent.parse(res.data), 'zParent.parse must not throw for minimal parent');
  });

  it('GET full parent — zod validates the response shape', async () => {
    const res = await getParent({ client, path: { parentId: fullParentId } });
    assert.doesNotThrow(() => zParent.parse(res.data), 'zParent.parse must not throw');
  });

  it('GET list of parents — every item has owner object, no ownerId', async () => {
    const res = await listParents({ client });
    assert.equal(res.status, 200);
    const list = res.data as { items: Record<string, unknown>[] };
    assert.ok(list.items.length >= 2, 'list must have at least two parents');
    for (const item of list.items) {
      assert.equal(typeof item.owner, 'object', `parent ${item.id}: owner must be an object`);
      assert.equal(item.ownerId, undefined, `parent ${item.id}: ownerId must not be present`);
    }
  });

  // ---------------------------------------------------------------------------
  // Links-only tests: GET Child (parentId kept + links object added)
  // ---------------------------------------------------------------------------

  it('GET full child — parentId is PRESENT (not removed by links-only)', async () => {
    const res = await getChild({ client, path: { childId: fullChildId } });
    assert.equal(res.status, 200);
    const child = res.data as Record<string, unknown>;
    assert.ok(child.parentId, 'parentId must be present');
    assert.equal(typeof child.parentId, 'string', 'parentId must be a string');
  });

  it('GET full child — links object is present', async () => {
    const res = await getChild({ client, path: { childId: fullChildId } });
    const child = res.data as Record<string, unknown>;
    assert.ok(child.links, 'links must be present');
    assert.equal(typeof child.links, 'object', 'links must be an object');
  });

  it('GET full child — links.parent is a string URL containing the parentId value', async () => {
    const res = await getChild({ client, path: { childId: fullChildId } });
    const child = res.data as { parentId: string; links: Record<string, string> };
    assert.equal(typeof child.links.parent, 'string', 'links.parent must be a string');
    assert.ok(
      child.links.parent.includes(child.parentId),
      `links.parent must contain the parentId value (${child.parentId})`
    );
  });

  it('GET full child — no parent object (not expanded)', async () => {
    const res = await getChild({ client, path: { childId: fullChildId } });
    const child = res.data as Record<string, unknown>;
    assert.equal(child.parent, undefined, 'parent object must not be present for links-only');
  });

  it('GET full child — note optional field present when set', async () => {
    const res = await getChild({ client, path: { childId: fullChildId } });
    const child = res.data as Record<string, unknown>;
    assert.equal(child.note, 'child note value', 'note must be present with correct value');
  });

  it('GET minimal child — note optional field absent without error', async () => {
    const res = await getChild({ client, path: { childId: minChildId } });
    const child = res.data as Record<string, unknown>;
    assert.equal(child.note, undefined, 'note must be absent when not set');
  });

  it('GET full child — zod validates the response shape', async () => {
    const res = await getChild({ client, path: { childId: fullChildId } });
    assert.doesNotThrow(() => zChild.parse(res.data), 'zChild.parse must not throw');
  });

  it('GET list of children — every item has parentId and links.parent', async () => {
    const res = await listChildren({ client });
    assert.equal(res.status, 200);
    const list = res.data as { items: Record<string, unknown>[] };
    assert.ok(list.items.length >= 2, 'list must have at least two children');
    for (const item of list.items) {
      assert.ok(item.parentId, `child ${item.id}: parentId must be present`);
      const links = item.links as Record<string, string> | undefined;
      assert.ok(links, `child ${item.id}: links must be present`);
      assert.equal(typeof links.parent, 'string', `child ${item.id}: links.parent must be a string`);
    }
  });

  // ---------------------------------------------------------------------------
  // Update tests
  // ---------------------------------------------------------------------------

  it('PATCH Parent name — response has updated name, owner still expanded on GET', async () => {
    const patchRes = await updateParent({
      client,
      path: { parentId: fullParentId },
      body: { name: 'Updated Parent Name' },
    });
    assert.equal(patchRes.status, 200);

    // GET the parent and verify expand still works after patch
    const getRes = await getParent({ client, path: { parentId: fullParentId } });
    const parent = getRes.data as Record<string, unknown>;
    assert.equal(parent.name, 'Updated Parent Name', 'name must reflect the update');
    assert.equal(typeof parent.owner, 'object', 'owner must still be expanded after patch');
    assert.doesNotThrow(() => zParent.parse(getRes.data), 'zParent.parse must not throw after patch');
  });

  it('PATCH Child parentId — GET reflects new parentId and new links.parent URL', async () => {
    // Reassign fullChild from fullParent to minParent
    const patchRes = await updateChild({
      client,
      path: { childId: fullChildId },
      body: { parentId: minParentId },
    });
    assert.equal(patchRes.status, 200);

    const getRes = await getChild({ client, path: { childId: fullChildId } });
    const child = getRes.data as { parentId: string; links: Record<string, string> };
    assert.equal(child.parentId, minParentId, 'parentId must reflect the new value');
    assert.ok(
      child.links.parent.includes(minParentId),
      `links.parent must reference the new parentId (${minParentId})`
    );
  });

  it('zParentUpdate shape does NOT include owner (expanded object), DOES include ownerId', () => {
    const shape = (zParentUpdate as unknown as { shape: Record<string, unknown> }).shape;
    assert.equal('owner' in shape, false, 'owner (expanded object) must not be in ParentUpdate schema');
    assert.ok('ownerId' in shape, 'ownerId (flat FK) must be in ParentUpdate schema');
  });

  it('zChildUpdate shape DOES include parentId', () => {
    const shape = (zChildUpdate as unknown as { shape: Record<string, unknown> }).shape;
    assert.ok('parentId' in shape, 'parentId must be in ChildUpdate schema');
  });
});
