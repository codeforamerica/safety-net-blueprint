/**
 * Unit tests for x-relationship expand logic in the mock server.
 *
 * Leo's bug: when x-relationship.style: expand is configured on a FK field,
 * the mock should replace the FK value (e.g. memberId: uuid) with the related
 * object (e.g. member: { id, applicationId, roles, ... }) in GET responses.
 *
 * The resolver renames memberId → member in the resolved spec schema and
 * preserves x-relationship: { fkField: memberId, style: expand } on the new
 * field so the mock can find the original DB field name at request time.
 *
 * These tests verify the two expansion utilities:
 *   extractExpandFields — reads a response schema and finds expand-annotated fields
 *   applyExpand        — substitutes FK values with related objects in a record
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractExpandFields, applyExpand } from '../../src/handlers/expand-utils.js';

test('extractExpandFields — finds x-relationship.style: expand fields in a flat schema', () => {
  const responseSchema = {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      member: {
        $ref: '#/components/schemas/ApplicationMember',
        'x-relationship': { resource: 'ApplicationMember', style: 'expand', fkField: 'memberId' }
      },
      amount: { type: 'number' }
    }
  };

  const fields = extractExpandFields(responseSchema);

  assert.equal(fields.length, 1, 'should find one expand field');
  assert.equal(fields[0].fieldName, 'member');
  assert.equal(fields[0].fkField, 'memberId');
  assert.equal(fields[0].resource, 'ApplicationMember');
});

test('extractExpandFields — ignores links-only x-relationship fields (no style: expand)', () => {
  const responseSchema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      memberId: {
        type: 'string',
        format: 'uuid',
        'x-relationship': { resource: 'ApplicationMember' }
      }
    }
  };

  const fields = extractExpandFields(responseSchema);

  assert.equal(fields.length, 0, 'links-only fields should not be in expand list');
});

test('extractExpandFields — finds expand fields inside allOf', () => {
  const responseSchema = {
    allOf: [
      { $ref: '#/components/schemas/Base' },
      {
        type: 'object',
        properties: {
          member: {
            $ref: '#/components/schemas/ApplicationMember',
            'x-relationship': { resource: 'ApplicationMember', style: 'expand', fkField: 'memberId' }
          }
        }
      }
    ]
  };

  const fields = extractExpandFields(responseSchema);

  assert.equal(fields.length, 1);
  assert.equal(fields[0].fieldName, 'member');
});

test('extractExpandFields — returns empty array when schema has no x-relationship', () => {
  const responseSchema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      amount: { type: 'number' }
    }
  };

  const fields = extractExpandFields(responseSchema);

  assert.equal(fields.length, 0);
});

test('applyExpand — replaces FK field with the related object', () => {
  const record = { id: 'inc-1', memberId: 'mem-1', type: 'employed', amount: 3000 };
  const expandFields = [
    { fieldName: 'member', fkField: 'memberId', collection: 'application-members' }
  ];
  const lookup = (collection, id) => {
    if (collection === 'application-members' && id === 'mem-1') {
      return { id: 'mem-1', applicationId: 'app-1', roles: ['primary_applicant'] };
    }
    return null;
  };

  const result = applyExpand(record, expandFields, lookup);

  assert.equal(result.memberId, undefined, 'FK field should be removed from the record');
  assert.deepEqual(result.member, { id: 'mem-1', applicationId: 'app-1', roles: ['primary_applicant'] });
});

test('applyExpand — leaves record unchanged when related record not found', () => {
  const record = { id: 'inc-1', memberId: 'ghost-id', type: 'employed', amount: 3000 };
  const expandFields = [
    { fieldName: 'member', fkField: 'memberId', collection: 'application-members' }
  ];
  const lookup = () => null;

  const result = applyExpand(record, expandFields, lookup);

  // When the related record cannot be found, keep the original FK intact
  // rather than returning null/undefined and breaking the response shape.
  assert.equal(result.memberId, 'ghost-id', 'FK should be preserved if lookup fails');
  assert.equal(result.member, undefined, 'expanded field should not be present');
});

test('applyExpand — handles multiple expand fields on the same record', () => {
  const record = { id: 'inc-1', memberId: 'mem-1', applicationId: 'app-1', type: 'employed' };
  const expandFields = [
    { fieldName: 'member', fkField: 'memberId', collection: 'application-members' },
    { fieldName: 'application', fkField: 'applicationId', collection: 'applications' }
  ];
  const lookup = (collection, id) => {
    if (collection === 'application-members' && id === 'mem-1') return { id: 'mem-1', roles: ['primary_applicant'] };
    if (collection === 'applications' && id === 'app-1') return { id: 'app-1', status: 'draft' };
    return null;
  };

  const result = applyExpand(record, expandFields, lookup);

  assert.equal(result.memberId, undefined);
  assert.equal(result.applicationId, undefined);
  assert.deepEqual(result.member, { id: 'mem-1', roles: ['primary_applicant'] });
  assert.deepEqual(result.application, { id: 'app-1', status: 'draft' });
});

test('applyExpand — does not mutate the original record', () => {
  const record = { id: 'inc-1', memberId: 'mem-1', type: 'employed' };
  const expandFields = [
    { fieldName: 'member', fkField: 'memberId', collection: 'application-members' }
  ];
  const lookup = () => ({ id: 'mem-1' });

  applyExpand(record, expandFields, lookup);

  assert.equal(record.memberId, 'mem-1', 'original record should not be mutated');
  assert.equal(record.member, undefined, 'original record should not be mutated');
});
