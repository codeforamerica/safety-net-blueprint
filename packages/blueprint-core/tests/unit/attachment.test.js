/**
 * What a state machine, composition or rule set attaches to: decided by the
 * resource it names, read from each OpenAPI document's model, never by a
 * filename.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { toDoc } from '../../src/doc.js';
import { governedResource, declaredResource } from '../../src/attachment.js';
import { generateRpcOverlays } from '../../src/generate/rpc.js';
import { generatedOverlays } from '../../src/generate.js';

const returns = (schema) => ({
  get: { responses: { 200: { content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } } } } },
});

const api = (relativePath, domain, base, paths, extra = {}) => toDoc({
  path: `/set/${relativePath}`,
  relativePath,
  type: 'openapi',
  content: { openapi: '3.1.0', info: { title: relativePath, version: '1.0.0', 'x-domain': domain, ...extra }, servers: [{ url: base }], paths },
});

const intake = api('domains/intake/intake-openapi.yaml', 'intake', '/intake', {
  '/applications/{applicationId}': returns('Application'),
  '/applications/{applicationId}/verifications/{verificationId}': returns('Verification'),
});

// A second document in the same domain, as a framework file beside a set's own
// would be — named nothing like its domain.
const transcripts = api('base/domains/intake/platform-transcripts-openapi.yaml', 'intake', '/intake', {
  '/transcripts/{transcriptId}': returns('Transcript'),
});

describe('governedResource', () => {
  test('finds the resource named for the object, in whichever document of the domain declares it', () => {
    const docs = [intake, transcripts];

    assert.equal(governedResource(docs, 'intake', 'Verification').resource.path('item'),
      '/applications/{applicationId}/verifications/{verificationId}');
    assert.equal(governedResource(docs, 'intake', 'Transcript').api, transcripts);
  });

  test('looks only in the domain', () => {
    const other = api('domains/workflow/workflow-openapi.yaml', 'workflow', '/workflow', { '/tasks/{taskId}': returns('Task') });
    assert.equal(governedResource([intake, other], 'intake', 'Task'), null);
  });

  test('a deprecated document governs nothing', () => {
    const old = api('domains/intake/old-openapi.yaml', 'intake', '/intake', { '/notes/{noteId}': returns('Note') }, { 'x-status': 'deprecated' });
    assert.equal(governedResource([intake, old], 'intake', 'Note'), null);
  });

  test('two resources named for the object refuse to guess', () => {
    const twin = api('domains/intake/twin-openapi.yaml', 'intake', '/intake', { '/apps/{appId}': returns('Application') });
    assert.throws(() => governedResource([intake, twin], 'intake', 'Application'), /matches 2 resources/);
  });
});

describe('declaredResource', () => {
  test('the top-level resource whose collection the compositions name', () => {
    const declared = declaredResource([intake, transcripts], 'intake', ['applications'], 'x');
    assert.equal(declared.resource.name, 'Application');
    assert.equal(declared.api, intake);
  });

  test('a nested collection is not a composition root', () => {
    assert.equal(declaredResource([intake], 'intake', ['verifications'], 'x'), null);
  });

  test('a domain that declares none of them attaches to nothing', () => {
    assert.equal(declaredResource([intake], 'intake', ['parents'], 'x'), null);
  });

  test('resources in two documents refuse to guess', () => {
    assert.throws(() => declaredResource([intake, transcripts], 'intake', ['applications', 'transcripts'], 'Compositions in x'),
      /Compositions in x names resources in 2 OpenAPI documents/);
  });
});

describe('generateRpcOverlays', () => {
  const machines = toDoc({
    path: '/set/domains/intake/intake-state-machine.yaml',
    relativePath: 'domains/intake/intake-state-machine.yaml',
    type: 'state-machine',
    content: {
      domain: 'intake',
      machines: [
        { object: 'Application', states: [{ id: 'draft' }], initialState: 'draft', actions: [{ id: 'submit' }] },
        { object: 'Verification', states: [{ id: 'pending' }], initialState: 'pending', actions: [{ id: 'satisfy' }] },
        { object: 'Transcript', states: [{ id: 'recording' }], initialState: 'recording', actions: [{ id: 'pause' }] },
      ],
    },
  });

  const pathsAdded = (overlays) => overlays.flatMap((o) => o.overlay.actions
    .filter((a) => a.target === '$.paths')
    .map((a) => `${a.file} ${Object.keys(a.update).join(',')}`));

  test('each machine lands on its own resource, in the document that declares it', () => {
    assert.deepEqual(pathsAdded(generateRpcOverlays([intake, transcripts, machines])), [
      'domains/intake/intake-openapi.yaml /applications/{applicationId}/submit',
      'domains/intake/intake-openapi.yaml /applications/{applicationId}/verifications/{verificationId}/satisfy',
      'base/domains/intake/platform-transcripts-openapi.yaml /transcripts/{transcriptId}/pause',
    ]);
  });
});

describe('a state machine still naming apiSpec', () => {
  test('is warned that it is ignored', async () => {
    const { validate } = await import('../../src/validate.js');
    const machines = toDoc({
      path: '/set/domains/intake/intake-state-machine.yaml',
      relativePath: 'domains/intake/intake-state-machine.yaml',
      type: 'state-machine',
      content: { domain: 'intake', apiSpec: 'intake-openapi.yaml', machines: [] },
    });
    const warnings = validate([intake, machines]).results.flatMap((r) => r.warnings);
    assert.ok(warnings.some((w) => w.rule === 'deprecated-api-spec'));
  });
});

describe('an operation written by hand that a generated one would replace', async () => {
  const { generate } = await import('../../src/index.js');
  const machine = toDoc({
    path: '/set/domains/intake/intake-state-machine.yaml',
    relativePath: 'domains/intake/intake-state-machine.yaml',
    type: 'state-machine',
    content: { domain: 'intake', machines: [{ object: 'Application', states: [{ id: 'draft' }], initialState: 'draft', actions: [{ id: 'submit' }] }] },
  });
  const withSubmit = (operation) => api('domains/intake/intake-openapi.yaml', 'intake', '/intake', {
    '/applications/{applicationId}': returns('Application'),
    '/applications/{applicationId}/submit': { post: operation },
  });

  test('is refused, naming the operation, the document and the action', () => {
    assert.throws(
      () => generatedOverlays([withSubmit({ operationId: 'submitByHand', responses: {} }), machine]),
      /POST \/applications\/\{applicationId\}\/submit is written in domains\/intake\/intake-openapi\.yaml and also generated from the intake state machine's "submit" action/,
    );
  });

  test('one resolve generated earlier, carrying the same marker, is not', () => {
    const marked = { operationId: 'submitApplication', 'x-relationship': { type: 'state-machine-action', domain: 'intake', id: 'submit' }, responses: {} };
    assert.doesNotThrow(() => generatedOverlays([withSubmit(marked), machine]));
  });
});
