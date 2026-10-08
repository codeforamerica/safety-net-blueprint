/**
 * Unit tests for document upload and content handlers.
 *
 * Multipart is parsed with `request.formData()` (#448 step 5), so these cases
 * build real `FormData` rather than a mock `req.file`. The behavior that
 * matters most is negative: no file bytes are stored anywhere.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { createMemoryStore } from '../../src/stores/memory-store.js';
import {
  createDocumentUploadHandler,
  createDocumentVersionUploadHandler,
} from '../../src/handlers/document-upload-handler.js';
import { createDocumentContentHandler } from '../../src/handlers/document-content-handler.js';
import { readResponse } from '../helpers/fetch.js';

const store = createMemoryStore();
const deps = { store };
const BASE = 'http://localhost:1080';
const DOC_TYPE = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
const CONTENT = 'hello, world!';

/**
 * Build a multipart upload request.
 *
 * @param {object} [options]
 * @param {boolean} [options.file] - Include the file part
 * @param {Record<string,string>} [options.fields] - Replaces the default fields
 */
function uploadRequest({ file = true, fields } = {}) {
  const form = new FormData();
  if (file) form.set('file', new File([CONTENT], 'test.txt', { type: 'text/plain' }));
  for (const [k, v] of Object.entries(fields ?? { documentTypeId: DOC_TYPE, title: 'Test Document' })) {
    form.set(k, v);
  }
  return new Request(`${BASE}/document-management/documents`, {
    method: 'POST',
    body: form,
    headers: { 'x-caller-id': 'user-1' },
  });
}

const upload = () => createDocumentUploadHandler(BASE, deps);

// =============================================================================
// uploadDocument
// =============================================================================

test('uploadDocument — creates document and version records from the file metadata', async () => {
  const { status, body, headers } = await readResponse(upload()(uploadRequest(), { params: {} }));

  assert.strictEqual(status, 201);
  assert.ok(headers.get('Location').endsWith(`/document-management/documents/${body.id}`));
  assert.strictEqual(body.title, 'Test Document');
  assert.strictEqual(body.documentTypeId, DOC_TYPE);
  assert.strictEqual(body.lifecycleState, 'active');

  const version = store.findById('document-versions', body.latestVersionId);
  assert.strictEqual(version.fileName, 'test.txt');
  assert.strictEqual(version.mimeType, 'text/plain');
  assert.strictEqual(version.sizeBytes, CONTENT.length);
  assert.strictEqual(version.versionNumber, 1);
  assert.strictEqual(version.uploadedById, 'user-1');
  assert.match(version.contentHash, /^[0-9a-f]{64}$/, 'content is hashed in flight');
});

test('uploadDocument — stores no file bytes anywhere', async () => {
  // The guarantee the metadata-only design exists for: a snapshot is made to be
  // shared, so uploaded content must never be able to reach one.
  const { body } = await readResponse(upload()(uploadRequest(), { params: {} }));
  const serialized = JSON.stringify(store.snapshot());

  assert.ok(!serialized.includes(CONTENT), 'uploaded content must not appear in the store');
  assert.strictEqual(store.findById('document-versions', body.latestVersionId).content, undefined);
});

test('uploadDocument — returns 422 when file is missing', async () => {
  const { status, body } = await readResponse(upload()(uploadRequest({ file: false }), { params: {} }));
  assert.strictEqual(status, 422);
  assert.strictEqual(body.details[0].field, 'file');
});

test('uploadDocument — returns 422 when documentTypeId is missing', async () => {
  const request = uploadRequest({ fields: { title: 'Test Document' } });
  const { status, body } = await readResponse(upload()(request, { params: {} }));
  assert.strictEqual(status, 422);
  assert.strictEqual(body.details[0].field, 'documentTypeId');
});

test('uploadDocument — returns 422 when title is missing', async () => {
  const request = uploadRequest({ fields: { documentTypeId: DOC_TYPE } });
  const { status, body } = await readResponse(upload()(request, { params: {} }));
  assert.strictEqual(status, 422);
  assert.strictEqual(body.details[0].field, 'title');
});

test('uploadDocument — returns 400 when metadata is invalid JSON', async () => {
  const request = uploadRequest({
    fields: { documentTypeId: DOC_TYPE, title: 'T', metadata: '{not json' },
  });
  const { status, body } = await readResponse(upload()(request, { params: {} }));
  assert.strictEqual(status, 400);
  assert.strictEqual(body.code, 'BAD_REQUEST');
});

test('uploadDocument — parses metadata JSON string onto the document record', async () => {
  const request = uploadRequest({
    fields: { documentTypeId: DOC_TYPE, title: 'T', metadata: '{"source":"scanner"}' },
  });
  const { body } = await readResponse(upload()(request, { params: {} }));
  assert.deepStrictEqual(body.metadata, { source: 'scanner' });
});

// =============================================================================
// uploadDocumentVersion
// =============================================================================

test('uploadDocumentVersion — adds a version and increments versionNumber', async () => {
  const { body: document } = await readResponse(upload()(uploadRequest(), { params: {} }));

  const handler = createDocumentVersionUploadHandler(BASE, deps);
  const { status, body: version } = await readResponse(
    handler(uploadRequest(), { params: { documentId: document.id } })
  );

  assert.strictEqual(status, 201);
  assert.strictEqual(version.versionNumber, 2);
  assert.strictEqual(version.documentId, document.id);
  assert.strictEqual(store.findById('documents', document.id).latestVersionId, version.id);
});

test('uploadDocumentVersion — returns 404 when the document does not exist', async () => {
  const handler = createDocumentVersionUploadHandler(BASE, deps);
  const { status, body } = await readResponse(
    handler(uploadRequest(), { params: { documentId: 'missing' } })
  );
  assert.strictEqual(status, 404);
  assert.strictEqual(body.code, 'NOT_FOUND');
});

// =============================================================================
// getDocumentVersionContent
// =============================================================================

test('getDocumentVersionContent — returns a placeholder describing the file', async () => {
  const { body: document } = await readResponse(upload()(uploadRequest(), { params: {} }));
  const handler = createDocumentContentHandler(deps);
  const request = new Request(`${BASE}/document-management/document-versions/x/content`);

  const { status, body, headers } = await readResponse(
    handler(request, { params: { documentVersionId: document.latestVersionId } })
  );

  assert.strictEqual(status, 200);
  assert.strictEqual(body.placeholder, true);
  assert.strictEqual(body.fileName, 'test.txt');
  assert.strictEqual(body.mimeType, 'text/plain');
  assert.strictEqual(body.sizeBytes, CONTENT.length);
  assert.ok(!JSON.stringify(body).includes(CONTENT), 'the placeholder must not carry the content');

  // JSON, not the recorded MIME type — claiming text/plain over a JSON body is
  // the one option a client would be misled by.
  assert.match(headers.get('Content-Type'), /application\/json/);
  assert.strictEqual(headers.get('Content-Disposition'), 'attachment; filename="test.txt.placeholder.json"');
});

test('getDocumentVersionContent — returns 404 when the version does not exist', async () => {
  const handler = createDocumentContentHandler(deps);
  const request = new Request(`${BASE}/document-management/document-versions/missing/content`);
  const { status, body } = await readResponse(handler(request, { params: { documentVersionId: 'missing' } }));
  assert.strictEqual(status, 404);
  assert.strictEqual(body.code, 'NOT_FOUND');
});
