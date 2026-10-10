/**
 * An OpenAPI document read as the resources it serves.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildApiModel } from '../../../src/openapi/model.js';
import { toDoc } from '../../../src/doc.js';

const returns = (schema) => ({
  get: { responses: { 200: { content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } } } } },
});

const intake = {
  openapi: '3.1.0',
  info: { title: 'Intake', version: '1.0.0', 'x-domain': 'intake' },
  servers: [{ url: 'https://api.example.com/intake' }],
  paths: {
    '/applications': { get: {} },
    '/applications/{applicationId}': returns('Application'),
    '/applications/{applicationId}/submit': { post: {} },
    '/applications/{applicationId}/interview': { get: {} },
    '/applications/{applicationId}/verifications': { get: {} },
    '/applications/{applicationId}/verifications/{verificationId}': returns('Verification'),
    '/applications/{applicationId}/verifications/{verificationId}/satisfy': { post: {} },
  },
};

const byName = (model, name) => model.resources.find((r) => r.name === name);

describe('buildApiModel', () => {
  test('the base comes from the first server', () => {
    assert.equal(buildApiModel(intake).base, '/intake');
    assert.equal(buildApiModel({ ...intake, servers: [{ url: 'http://localhost:1080/platform/' }] }).base, '/platform');
    assert.equal(buildApiModel({ ...intake, servers: undefined }).base, '');
  });

  test('a resource is named for the schema its item endpoint returns', () => {
    const model = buildApiModel(intake);
    assert.deepEqual(model.resources.map((r) => r.name), ['Application', 'Verification']);
  });

  test('resources link to their parent and children', () => {
    const model = buildApiModel(intake);
    const application = byName(model, 'Application');
    const verification = byName(model, 'Verification');

    assert.equal(verification.parent, application);
    assert.deepEqual(application.children, [verification]);
    assert.equal(application.parent, null);
  });

  test('a resource knows its collection segment and item parameter', () => {
    const verification = byName(buildApiModel(intake), 'Verification');
    assert.deepEqual(verification.collection, { segment: 'verifications' });
    assert.deepEqual(verification.item, { parameter: 'verificationId' });
  });

  test('path() writes the item and collection paths from the links', () => {
    const verification = byName(buildApiModel(intake), 'Verification');
    assert.equal(verification.path('item'), '/applications/{applicationId}/verifications/{verificationId}');
    assert.equal(verification.path('collection'), '/applications/{applicationId}/verifications');
  });

  test('actions and singletons are not resources', () => {
    // `/submit`, `/satisfy` and `/interview` end in a plain segment. They are
    // not modeled yet; a singleton will land on the resource that owns it.
    const model = buildApiModel(intake);
    assert.equal(model.resources.length, 2);
  });

  test('a nested resource has its ancestors even when they state no schema', () => {
    const model = buildApiModel({
      paths: { '/households/{householdId}/members/{memberId}': returns('Member') },
    });
    const member = byName(model, 'Member');

    assert.equal(member.parent.name, null);
    assert.equal(member.parent.collection.segment, 'households');
    assert.equal(member.path('item'), '/households/{householdId}/members/{memberId}');
  });

  test('a schema returned inline names nothing', () => {
    const model = buildApiModel({
      paths: { '/tasks/{taskId}': { get: { responses: { 200: { content: { 'application/json': { schema: { type: 'object' } } } } } } } },
    });
    assert.equal(model.resources[0].name, null);
  });
});

describe('Doc.model() for an OpenAPI document', () => {
  test('is the API model', () => {
    const d = toDoc({ path: '/x/intake-openapi.yaml', relativePath: 'domains/intake/intake-openapi.yaml', type: 'openapi', content: intake });
    assert.deepEqual(d.model().resources.map((r) => r.name), ['Application', 'Verification']);
  });

  test('reads the content it has now, after a pass replaces it', () => {
    const d = toDoc({ path: '/x/intake-openapi.yaml', relativePath: 'domains/intake/intake-openapi.yaml', type: 'openapi', content: intake });
    const passed = { ...d, content: { ...intake, servers: [{ url: '/elsewhere' }] } };
    assert.equal(passed.model().base, '/elsewhere');
  });

  test('stays null for AsyncAPI and JSON Schema', () => {
    assert.equal(toDoc({ path: '/x/a.yaml', type: 'asyncapi', content: { asyncapi: '3.0.0' } }).model(), null);
    assert.equal(toDoc({ path: '/x/s.yaml', type: 'schema', content: { $defs: {} } }).model(), null);
  });
});
