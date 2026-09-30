/**
 * Unit tests for resolve/relationships.js
 *
 * A foreign key annotated with `x-relationship` is rendered according to the
 * configured style. Expanding renames the field — `memberId` becomes
 * `member` — which is why example data has to be reconciled in the same
 * pass rather than a later one.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRelationshipAnnotations } from '../../../src/resolve/relationships.js';
import { doc } from '../../helpers/docs.js';

const spec = (schemas, relativePath = 'domains/intake/intake-openapi.yaml') => doc(
  { openapi: '3.1.0', info: { title: 'Intake', version: '1.0.0' }, components: { schemas } },
  { relativePath, type: 'openapi' }
);

const withFk = () => spec({
  Member: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
  Application: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      memberId: { type: 'string', format: 'uuid', 'x-relationship': { resource: 'Member' } },
    },
  },
});

const content = (result) => result.docs[0].content;

describe('resolveRelationshipAnnotations', () => {
  test('no style leaves the annotation as metadata', () => {
    // Nothing has been configured, so the annotation still carries its
    // information and the field is untouched.
    const input = [withFk()];
    const result = resolveRelationshipAnnotations(input, null);

    const props = content(result).components.schemas.Application.properties;
    assert.ok(props.memberId);
    assert.deepEqual(props.memberId['x-relationship'], { resource: 'Member' });
  });

  test('a document with no annotations is returned unchanged', () => {
    const untouched = spec({ Thing: { type: 'object', properties: { name: { type: 'string' } } } });
    const result = resolveRelationshipAnnotations([untouched], 'expand');

    assert.equal(result.docs[0], untouched);
    assert.deepEqual(result.applied, []);
  });

  test('reports which documents it resolved and in what style', () => {
    const result = resolveRelationshipAnnotations([withFk()], 'links-only');

    assert.equal(result.applied.length, 1);
    assert.match(result.applied[0], /links-only/);
    assert.match(result.applied[0], /intake-openapi\.yaml/);
  });

  test('a reserved resource stays a scalar foreign key', () => {
    // External and Polymorphic name no resolvable schema — there is nothing
    // to expand to, so expanding would produce an empty object.
    const external = spec({
      Application: {
        type: 'object',
        properties: {
          vendorId: { type: 'string', format: 'uuid', 'x-relationship': { resource: 'External' } },
        },
      },
    });

    const props = content(resolveRelationshipAnnotations([external], 'expand'))
      .components.schemas.Application.properties;

    assert.ok(props.vendorId, 'field kept its name');
    assert.equal(props.vendorId.type, 'string');
    assert.equal(props.vendor, undefined, 'nothing expanded');
  });

  test('warns rather than throwing when the resource names no schema', () => {
    const dangling = spec({
      Application: {
        type: 'object',
        properties: {
          ghostId: { type: 'string', format: 'uuid', 'x-relationship': { resource: 'Ghost' } },
        },
      },
    });

    const result = resolveRelationshipAnnotations([dangling], 'expand');
    assert.ok(result.warnings.length > 0);
    assert.match(result.warnings.join('\n'), /Ghost/);
  });

  test('every pass returns the same shape', () => {
    const result = resolveRelationshipAnnotations([withFk()], 'links-only');

    assert.ok(Array.isArray(result.docs));
    assert.ok(Array.isArray(result.warnings));
    assert.ok(Array.isArray(result.applied));
  });
});
