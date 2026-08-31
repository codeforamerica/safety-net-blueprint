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

let fullOwnerId: string;
let minOwnerId: string;
let fullParentId: string;
let minParentId: string;
let fullChildId: string;
let minChildId: string;

describe('Functional — x-relationship: expand and links-only', () => {
  before(async () => {
    // Two owners: one with optional note set, one without
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

    // Two parents: one with optional description set, one without
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

    // Two children: one with optional note set, one without
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
  // POST responses: expand and links-only apply on create as well as read
  // ---------------------------------------------------------------------------

  it('expand — POST response includes expanded object and passes schema', async () => {
    const ownerId = fullOwnerId;
    const res = await createParent({ client, body: { name: 'POST Test Parent', ownerId } });
    assert.equal(res.status, 201);
    assert.doesNotThrow(() => zParent.parse(res.data), 'zParent.parse must not throw on POST 201 response');
    const body = res.data as Record<string, unknown>;
    assert.equal(typeof body.owner, 'object', 'POST response must include expanded owner, not just ownerId');
  });

  it('links-only — POST response includes links object and passes schema', async () => {
    const res = await createChild({ client, body: { label: 'POST Test Child', parentId: fullParentId } });
    assert.equal(res.status, 201);
    assert.doesNotThrow(() => zChild.parse(res.data), 'zChild.parse must not throw on POST 201 response');
    const body = res.data as { links: Record<string, string> };
    assert.equal(typeof body.links?.parent, 'string', 'POST response must include links.parent');
  });

  // ---------------------------------------------------------------------------
  // Expand: Parent → Owner
  // zParent schema requires owner as a nested object with required label,
  // optional note, and system fields (id, createdAt, updatedAt).
  // ---------------------------------------------------------------------------

  it('expand — GET response passes schema when all fields (required + optional) are populated', async () => {
    const res = await getParent({ client, path: { parentId: fullParentId } });
    assert.equal(res.status, 200);
    assert.doesNotThrow(() => zParent.parse(res.data), 'zParent.parse must not throw');
  });

  it('expand — GET response passes schema when linked owner has no optional fields set', async () => {
    // minParent links to minOwner which has no note — owner.note is optional and must not break validation
    const res = await getParent({ client, path: { parentId: minParentId } });
    assert.doesNotThrow(() => zParent.parse(res.data), 'zParent.parse must not throw when owner.note is absent');
  });

  it('expand — schema rejects a response where the expanded owner field is missing', () => {
    // owner is a required field in zParent — if the mock omits it, clients would get a validation failure
    const responseWithoutOwner = {
      id: '00000002-0000-4000-8000-000000000001',
      name: 'Some Parent',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    assert.throws(
      () => zParent.parse(responseWithoutOwner),
      'zParent.parse must throw when owner is absent'
    );
  });

  it('expand — GET response includes both ownerId (FK) and owner (expanded object)', async () => {
    // Both must coexist: ownerId for write payloads, owner for read consumers (Writable pattern)
    const res = await getParent({ client, path: { parentId: fullParentId } });
    const parent = res.data as Record<string, unknown>;
    assert.ok(parent.ownerId, 'ownerId must be present alongside the expanded owner object');
    assert.equal(typeof parent.owner, 'object', 'owner must be an expanded object, not absent or a primitive');
  });

  it('expand — GET list schema validates every item including the expanded owner', async () => {
    const res = await listParents({ client });
    assert.equal(res.status, 200);
    const list = res.data as { items: unknown[] };
    assert.ok(list.items.length >= 2, 'list must have at least two parents');
    for (const item of list.items) {
      assert.doesNotThrow(() => zParent.parse(item), `zParent.parse must not throw for list item`);
    }
  });

  // ---------------------------------------------------------------------------
  // Links-only: Child → Parent
  // zChild schema retains parentId as a required FK and adds an optional links
  // object. No expanded parent object is added.
  // ---------------------------------------------------------------------------

  it('links-only — GET response passes schema when all fields (required + optional) are populated', async () => {
    const res = await getChild({ client, path: { childId: fullChildId } });
    assert.equal(res.status, 200);
    assert.doesNotThrow(() => zChild.parse(res.data), 'zChild.parse must not throw');
  });

  it('links-only — GET response passes schema when optional note is absent', async () => {
    const res = await getChild({ client, path: { childId: minChildId } });
    assert.doesNotThrow(() => zChild.parse(res.data), 'zChild.parse must not throw when note is absent');
  });

  it('links-only — links.parent is a URL path containing the parentId value', async () => {
    // The link URL must resolve to the correct related resource
    const res = await getChild({ client, path: { childId: fullChildId } });
    const child = res.data as { parentId: string; links: Record<string, string> };
    assert.equal(typeof child.links.parent, 'string', 'links.parent must be a string');
    assert.ok(
      child.links.parent.includes(child.parentId),
      `links.parent must contain the parentId value (${child.parentId})`
    );
  });

  it('links-only — GET response retains parentId FK (links-only does not replace the FK field)', async () => {
    const res = await getChild({ client, path: { childId: fullChildId } });
    const child = res.data as Record<string, unknown>;
    assert.ok(child.parentId, 'parentId must be present — links-only adds links alongside the FK, not instead of it');
  });

  it('links-only — GET response has no expanded parent object (links-only does not expand the relationship)', async () => {
    const res = await getChild({ client, path: { childId: fullChildId } });
    const child = res.data as Record<string, unknown>;
    assert.equal(child.parent, undefined, 'parent object must not be present for links-only style');
  });

  it('links-only — GET list schema validates every item including links', async () => {
    const res = await listChildren({ client });
    assert.equal(res.status, 200);
    const list = res.data as { items: unknown[] };
    assert.ok(list.items.length >= 2, 'list must have at least two children');
    for (const item of list.items) {
      assert.doesNotThrow(() => zChild.parse(item), 'zChild.parse must not throw for list item');
    }
  });

  // ---------------------------------------------------------------------------
  // After updates: expand and links remain consistent
  // ---------------------------------------------------------------------------

  it('expand — GET after PATCH still passes schema with expanded owner', async () => {
    await updateParent({
      client,
      path: { parentId: fullParentId },
      body: { name: 'Updated Parent Name' },
    });
    const res = await getParent({ client, path: { parentId: fullParentId } });
    const parent = res.data as Record<string, unknown>;
    assert.equal(parent.name, 'Updated Parent Name', 'name must reflect the PATCH');
    assert.doesNotThrow(() => zParent.parse(res.data), 'zParent.parse must not throw after patch');
  });

  it('links-only — links.parent updates when parentId changes via PATCH', async () => {
    await updateChild({
      client,
      path: { childId: fullChildId },
      body: { parentId: minParentId },
    });
    const res = await getChild({ client, path: { childId: fullChildId } });
    const child = res.data as { parentId: string; links: Record<string, string> };
    assert.equal(child.parentId, minParentId, 'parentId must reflect the new value');
    assert.ok(
      child.links.parent.includes(minParentId),
      `links.parent must reference the new parentId (${minParentId})`
    );
  });

  // ---------------------------------------------------------------------------
  // Generated write schemas
  // Expand and links-only are read-side concerns. Write schemas must use the FK
  // field (ownerId, parentId), not the expanded object or links.
  // ---------------------------------------------------------------------------

  it('write schema — zParentUpdate uses ownerId (FK), not owner (expanded object is read-only)', () => {
    // zParentUpdate is a ZodIntersection (.and()), shape lives on _def.left
    const shape = (zParentUpdate as unknown as { _def: { left: { shape: Record<string, unknown> } } })._def.left.shape;
    assert.ok('ownerId' in shape, 'ownerId must be in the write schema');
    assert.equal('owner' in shape, false, 'owner (expanded object) must not be in the write schema');
  });

  it('write schema — zChildUpdate retains parentId (links-only does not affect the write schema)', () => {
    // zChildUpdate is a ZodIntersection (.and()), shape lives on _def.left
    const shape = (zChildUpdate as unknown as { _def: { left: { shape: Record<string, unknown> } } })._def.left.shape;
    assert.ok('parentId' in shape, 'parentId must be in the write schema');
  });
});
