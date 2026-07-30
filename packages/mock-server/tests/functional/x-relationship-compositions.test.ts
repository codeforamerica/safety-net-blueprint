/**
 * Functional tests for the interaction between compositions and x-relationship.
 *
 * Key assertion: the composition assembler completely ignores x-relationship
 * annotations. The tests document current behavior — what composition logic
 * produces on its own, without any x-relationship expand or links-only applied.
 *
 * Composition behavior under test:
 *   1. parentOverview — no fields restriction; x-relationship expand is NOT applied;
 *      ownerId is in the response, owner object is NOT.
 *   2. parentOwnerLabel — fields: [name, owner.label]; dot-notation traverses
 *      record.owner?.label, but only ownerId is in the DB record, so owner.label
 *      returns null and is skipped; result is { name } only.
 *   3. parentChildrenWithLinks — include children with links: true; _links.self
 *      is added to each child item (composition feature); x-relationship links-only
 *      on Child.parentId is NOT applied; no links.parent object appears.
 *
 * When x-relationship support is added to the composition assembler, update the
 * assertions in variants 1 and 3 to match the new behavior (owner expanded,
 * links.parent present). Variant 2 assertions should also update once the
 * dot-notation FK traversal bug is fixed in the composition assembler.
 *
 * Run via: node tests/run-all-tests.js --functional
 * The server is started by the test runner before this file executes.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from './generated/typescript/x-relationship/client/index.js';
import {
  createOwner,
  createParent,
  createChild,
  getParentOverview,
  getParentOwnerLabel,
  getParentChildrenWithLinks,
} from './generated/typescript/x-relationship/sdk.gen.js';

const client = createClient({ baseURL: 'http://localhost:1080' });

let ownerId: string;
let parentId: string;

describe('Functional — compositions with x-relationship resources', () => {
  before(async () => {
    const ownerRes = await createOwner({ client, body: { label: 'Composition Test Owner' } });
    assert.equal(ownerRes.status, 201, 'createOwner must return 201');
    ownerId = (ownerRes.data as { id: string }).id;

    const parentRes = await createParent({ client, body: { name: 'Composition Test Parent', ownerId } });
    assert.equal(parentRes.status, 201, 'createParent must return 201');
    parentId = (parentRes.data as { id: string }).id;

    const childRes = await createChild({ client, body: { label: 'Composition Test Child', parentId } });
    assert.equal(childRes.status, 201, 'createChild must return 201');
    // childId not needed by name — children are looked up via parentId in compositions
  });

  // ---------------------------------------------------------------------------
  // Variant 1: parentOverview — no fields restriction
  //
  // Asserts: composition returns parent as stored in DB.
  // x-relationship expand on ownerId is NOT applied; no owner object in response.
  // The children include IS assembled (composition feature works).
  //
  // TODO: when x-relationship expand is added to the composition assembler,
  // update: assert owner is an object, ownerId still coexists (Writable pattern).
  // ---------------------------------------------------------------------------

  it('parentOverview — endpoint is accessible (200)', async () => {
    const res = await getParentOverview({ client, path: { parentId } });
    assert.equal(res.status, 200, 'GET /parents/{id}/overview must return 200');
  });

  it('parentOverview — response includes ownerId as stored in DB', async () => {
    const res = await getParentOverview({ client, path: { parentId } });
    const body = res.data as Record<string, unknown>;
    assert.ok(body.ownerId, 'ownerId must be present in the composition response');
  });

  it('parentOverview — x-relationship expand is NOT applied; no owner object in response', async () => {
    const res = await getParentOverview({ client, path: { parentId } });
    const body = res.data as Record<string, unknown>;
    // Current behavior: composition assembler ignores x-relationship.
    // Update this assertion to assert owner IS present once expand is supported.
    assert.equal(body.owner, undefined, 'owner must NOT be present — composition does not apply x-relationship expand');
  });

  it('parentOverview — children include is assembled correctly', async () => {
    const res = await getParentOverview({ client, path: { parentId } });
    const body = res.data as Record<string, unknown>;
    const children = body.children as unknown[];
    assert.ok(Array.isArray(children), 'children must be an array from the include node');
    assert.ok(children.length >= 1, 'children array must contain the seeded child');
    const child = children[0] as Record<string, unknown>;
    assert.ok(child.id, 'each child item must have an id field');
    assert.ok(child.label, 'each child item must have a label field');
    assert.ok(child.parentId, 'each child item must have a parentId field');
  });

  // ---------------------------------------------------------------------------
  // Variant 2: parentOwnerLabel — dot-notation fields: [name, owner.label]
  //
  // Asserts: composition projects 'name' correctly; 'owner.label' traverses
  // record.owner?.label which returns null (only ownerId is stored, not owner).
  // Result is { name } only — no ownerId, no owner object.
  //
  // This is a composition bug: dot-notation cannot traverse FK relationships
  // without a join. Fix: resolve FK before projecting.
  //
  // TODO: when the composition dot-notation FK bug is fixed, update:
  //   - assert owner.label is present with the owner's label value
  // ---------------------------------------------------------------------------

  it('parentOwnerLabel — endpoint is accessible (200)', async () => {
    const res = await getParentOwnerLabel({ client, path: { parentId } });
    assert.equal(res.status, 200, 'GET /parents/{id}/owner-label must return 200');
  });

  it('parentOwnerLabel — name field is projected correctly', async () => {
    const res = await getParentOwnerLabel({ client, path: { parentId } });
    const body = res.data as Record<string, unknown>;
    assert.equal(typeof body.name, 'string', 'name must be present and a string');
  });

  it('parentOwnerLabel — ownerId is absent (not in fields list)', async () => {
    const res = await getParentOwnerLabel({ client, path: { parentId } });
    const body = res.data as Record<string, unknown>;
    assert.equal(body.ownerId, undefined, 'ownerId must be absent — it was not in the fields list');
  });

  it('parentOwnerLabel — owner.label returns nothing; owner key is absent (composition dot-notation FK bug)', async () => {
    const res = await getParentOwnerLabel({ client, path: { parentId } });
    const body = res.data as Record<string, unknown>;
    // Current behavior: resolveDotPath(record, 'owner.label') returns null because
    // only ownerId is in the DB record, not owner. The null value is skipped by
    // projectFields, so out.owner is never set.
    // Update this assertion once the FK traversal bug is fixed.
    assert.equal(body.owner, undefined, 'owner must be absent — dot-notation FK traversal returns null (composition bug)');
    const keys = Object.keys(body);
    assert.deepEqual(keys, ['name'], 'only name should be in the projected response');
  });

  // ---------------------------------------------------------------------------
  // Variant 3: parentChildrenWithLinks — include children with links: true
  //
  // Asserts: _links.self is added to each child item (composition feature).
  // x-relationship links-only on Child.parentId is NOT applied — no links.parent.
  //
  // TODO: when x-relationship links-only is added to the composition assembler,
  // update: assert links.parent is also present alongside _links.self.
  // ---------------------------------------------------------------------------

  it('parentChildrenWithLinks — endpoint is accessible (200)', async () => {
    const res = await getParentChildrenWithLinks({ client, path: { parentId } });
    assert.equal(res.status, 200, 'GET /parents/{id}/children-with-links must return 200');
  });

  it('parentChildrenWithLinks — children include is assembled', async () => {
    const res = await getParentChildrenWithLinks({ client, path: { parentId } });
    const body = res.data as Record<string, unknown>;
    const children = body.children as unknown[];
    assert.ok(Array.isArray(children), 'children must be an array');
    assert.ok(children.length >= 1, 'children array must contain the seeded child');
  });

  it('parentChildrenWithLinks — links: true adds _links.self to each child item', async () => {
    const res = await getParentChildrenWithLinks({ client, path: { parentId } });
    const body = res.data as Record<string, unknown>;
    const children = body.children as Array<Record<string, unknown>>;
    for (const child of children) {
      const links = child._links as Record<string, unknown> | undefined;
      assert.ok(links, `_links must be present on child ${child.id} (composition links: true)`);
      assert.equal(typeof links.self, 'string', `_links.self must be a string on child ${child.id}`);
      assert.ok(
        (links.self as string).includes(child.id as string),
        `_links.self must contain the child id for child ${child.id}`
      );
    }
  });

  it('parentChildrenWithLinks — x-relationship links-only is NOT applied; no links.parent on children', async () => {
    const res = await getParentChildrenWithLinks({ client, path: { parentId } });
    const body = res.data as Record<string, unknown>;
    const children = body.children as Array<Record<string, unknown>>;
    for (const child of children) {
      // Current behavior: composition assembler ignores x-relationship.
      // Update this assertion to assert links.parent IS present once links-only is supported.
      const links = child.links as Record<string, unknown> | undefined;
      assert.equal(
        links?.parent,
        undefined,
        `links.parent must NOT be present on child ${child.id} — composition does not apply x-relationship links-only`
      );
    }
  });
});
