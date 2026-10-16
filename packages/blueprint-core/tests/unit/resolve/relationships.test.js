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

  // An API that shows one example for its expanded read schema and one for
  // the request body that still takes the key, and documents the related
  // record as an example of its own.
  const MEMBER_ID = '00000000-0000-4000-8000-000000000001';
  const member = { id: MEMBER_ID, name: 'Ada' };
  const withExamples = ({ documentMember = true } = {}) => doc({
    openapi: '3.1.0',
    info: { title: 'Intake', version: '1.0.0' },
    paths: {
      '/applications': {
        post: {
          requestBody: { content: { 'application/json': {
            schema: { $ref: '#/components/schemas/ApplicationCreate' },
            examples: { Create: { value: { memberId: MEMBER_ID } } },
          } } },
          responses: { 201: { content: { 'application/json': {
            schema: { $ref: '#/components/schemas/Application' },
            examples: { ApplicationExample1: { $ref: '#/components/examples/ApplicationExample1' } },
          } } } },
        },
      },
    },
    components: {
      schemas: {
        Member: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
        Application: {
          type: 'object',
          properties: { id: { type: 'string' }, memberId: { type: 'string', 'x-relationship': { resource: 'Member' } } },
        },
        ApplicationCreate: { type: 'object', properties: { memberId: { type: 'string' } } },
      },
      examples: {
        ApplicationExample1: { value: { id: 'a1', memberId: MEMBER_ID } },
        ...(documentMember && { MemberExample1: { value: member } }),
      },
    },
  }, { relativePath: 'domains/intake/intake-openapi.yaml', type: 'openapi' });

  test('an example shown for an expanded schema gets the documented related record', () => {
    const { examples } = content(resolveRelationshipAnnotations([withExamples()], 'expand')).components;

    assert.deepEqual(examples.ApplicationExample1.value, { id: 'a1', member });
  });

  test('a request example for a schema that keeps the key is left alone', () => {
    const create = content(resolveRelationshipAnnotations([withExamples()], 'expand'))
      .paths['/applications'].post.requestBody.content['application/json'].examples.Create;

    assert.deepEqual(create.value, { memberId: MEMBER_ID });
  });

  test('a related record that is only in seeds or config is warned about, not used', () => {
    // Seeds and config entries are stored and input shapes for other
    // purposes. Only documented examples fill in a documented example.
    const seeds = doc({ domain: 'intake', MemberExample1: member },
      { relativePath: 'domains/intake/intake-mock-data.yaml', type: 'mock-data' });
    const config = doc({ domain: 'intake', version: '1.0', members: { resource: 'Member', entries: [member] } },
      { relativePath: 'domains/intake/intake-config.yaml', type: 'config' });
    const result = resolveRelationshipAnnotations([withExamples({ documentMember: false }), seeds, config], 'expand');

    assert.notDeepEqual(content(result).components.examples.ApplicationExample1.value.member, member);
    assert.match(result.warnings.join('\n'), new RegExp(`no example found with id "${MEMBER_ID}"`));
  });

  test('seed data keeps the key, the way the server stores it', () => {
    const stored = { id: 'a1', memberId: MEMBER_ID };
    const seeds = doc({ domain: 'intake', ApplicationExample1: stored },
      { relativePath: 'domains/intake/intake-mock-data.yaml', type: 'mock-data' });
    const result = resolveRelationshipAnnotations([withExamples(), seeds], 'expand');

    assert.deepEqual(result.docs[1].content.ApplicationExample1, stored);
  });

  test('every pass returns the same shape', () => {
    const result = resolveRelationshipAnnotations([withFk()], 'links-only');

    assert.ok(Array.isArray(result.docs));
    assert.ok(Array.isArray(result.warnings));
    assert.ok(Array.isArray(result.applied));
  });
});
