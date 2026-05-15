/**
 * Unit tests for document upload and content handlers.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { clearAll, findById, findAll, insertResource } from '../../src/database-manager.js';
import { PassThrough } from 'stream';
import {
  createDocumentUploadHandler,
  createDocumentVersionUploadHandler,
  resolveUploadsDir
} from '../../src/handlers/document-upload-handler.js';
import { createDocumentContentHandler } from '../../src/handlers/document-content-handler.js';

// =============================================================================
// Helpers
// =============================================================================

function makeReq(overrides = {}) {
  return {
    file: {
      originalname: 'test.txt',
      mimetype: 'text/plain',
      size: 13,
      buffer: Buffer.from('hello, world!')
    },
    body: {
      documentTypeId: 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5',
      title: 'Test Document'
    },
    headers: { 'x-caller-id': 'user-1' },
    params: {},
    ...overrides
  };
}

function makeRes() {
  const res = {
    _status: 200,
    _headers: {},
    _body: null,
    status(code) { this._status = code; return this; },
    set(key, value) { this._headers[key] = value; return this; },
    setHeader(key, value) { this._headers[key] = value; },
    json(body) { this._body = body; return this; }
  };
  return res;
}

// =============================================================================
// resolveUploadsDir
// =============================================================================

test('resolveUploadsDir — returns MOCK_UPLOADS_DIR env var when set', () => {
  const original = process.env.MOCK_UPLOADS_DIR;
  process.env.MOCK_UPLOADS_DIR = '/custom/uploads';
  assert.strictEqual(resolveUploadsDir('/default'), '/custom/uploads');
  if (original === undefined) delete process.env.MOCK_UPLOADS_DIR;
  else process.env.MOCK_UPLOADS_DIR = original;
});

test('resolveUploadsDir — falls back to defaultDir when env var not set', () => {
  const original = process.env.MOCK_UPLOADS_DIR;
  delete process.env.MOCK_UPLOADS_DIR;
  assert.strictEqual(resolveUploadsDir('/default'), '/default');
  if (original !== undefined) process.env.MOCK_UPLOADS_DIR = original;
});

// =============================================================================
// uploadDocument
// =============================================================================

test('uploadDocument — creates document and version records, saves file to disk', () => {
  clearAll('documents');
  clearAll('document-versions');

  const uploadsDir = mkdtempSync(join(tmpdir(), 'doc-test-'));
  try {
    const [, handler] = createDocumentUploadHandler(uploadsDir, 'http://localhost:1080');
    const req = makeReq();
    const res = makeRes();

    handler(req, res);

    assert.strictEqual(res._status, 201);
    assert.ok(res._body.id, 'document has id');
    assert.strictEqual(res._body.title, 'Test Document');
    assert.strictEqual(res._body.lifecycleState, 'active');
    assert.strictEqual(res._body.legalHold, false);
    assert.ok(res._body.latestVersionId, 'document has latestVersionId');
    assert.ok(res._headers['Location']?.includes(res._body.id), 'Location header set');

    // Version record created
    const version = findById('document-versions', res._body.latestVersionId);
    assert.ok(version, 'version record exists');
    assert.strictEqual(version.versionNumber, 1);
    assert.strictEqual(version.fileName, 'test.txt');
    assert.strictEqual(version.mimeType, 'text/plain');
    assert.strictEqual(version.sizeBytes, 13);
    assert.strictEqual(version.uploadedById, 'user-1');

    // File saved to disk
    const filePath = join(uploadsDir, res._body.id, version.id);
    assert.ok(existsSync(filePath), 'file exists on disk');
    assert.strictEqual(readFileSync(filePath).toString(), 'hello, world!');
  } finally {
    rmSync(uploadsDir, { recursive: true, force: true });
  }
});

test('uploadDocument — returns 422 when file is missing', () => {
  const uploadsDir = mkdtempSync(join(tmpdir(), 'doc-test-'));
  try {
    const [, handler] = createDocumentUploadHandler(uploadsDir, 'http://localhost:1080');
    const req = makeReq({ file: null });
    const res = makeRes();

    handler(req, res);

    assert.strictEqual(res._status, 422);
    assert.strictEqual(res._body.code, 'VALIDATION_ERROR');
  } finally {
    rmSync(uploadsDir, { recursive: true, force: true });
  }
});

test('uploadDocument — returns 422 when documentTypeId is missing', () => {
  const uploadsDir = mkdtempSync(join(tmpdir(), 'doc-test-'));
  try {
    const [, handler] = createDocumentUploadHandler(uploadsDir, 'http://localhost:1080');
    const req = makeReq({ body: { title: 'Test' } });
    const res = makeRes();

    handler(req, res);

    assert.strictEqual(res._status, 422);
    assert.ok(res._body.details.some(d => d.field === 'documentTypeId'));
  } finally {
    rmSync(uploadsDir, { recursive: true, force: true });
  }
});

test('uploadDocument — returns 422 when title is missing', () => {
  const uploadsDir = mkdtempSync(join(tmpdir(), 'doc-test-'));
  try {
    const [, handler] = createDocumentUploadHandler(uploadsDir, 'http://localhost:1080');
    const req = makeReq({ body: { documentTypeId: 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5' } });
    const res = makeRes();

    handler(req, res);

    assert.strictEqual(res._status, 422);
    assert.ok(res._body.details.some(d => d.field === 'title'));
  } finally {
    rmSync(uploadsDir, { recursive: true, force: true });
  }
});

test('uploadDocument — returns 400 when metadata is invalid JSON', () => {
  const uploadsDir = mkdtempSync(join(tmpdir(), 'doc-test-'));
  try {
    const [, handler] = createDocumentUploadHandler(uploadsDir, 'http://localhost:1080');
    const req = makeReq({ body: { documentTypeId: 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5', title: 'Test', metadata: 'not-json' } });
    const res = makeRes();

    handler(req, res);

    assert.strictEqual(res._status, 400);
    assert.ok(res._body.details.some(d => d.field === 'metadata'));
  } finally {
    rmSync(uploadsDir, { recursive: true, force: true });
  }
});

test('uploadDocument — parses metadata JSON string onto document record', () => {
  clearAll('documents');
  clearAll('document-versions');

  const uploadsDir = mkdtempSync(join(tmpdir(), 'doc-test-'));
  try {
    const [, handler] = createDocumentUploadHandler(uploadsDir, 'http://localhost:1080');
    const req = makeReq({
      body: {
        documentTypeId: 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5',
        title: 'Test',
        metadata: JSON.stringify({ intake: { verificationId: 'ver-123' } })
      }
    });
    const res = makeRes();

    handler(req, res);

    assert.deepStrictEqual(res._body.metadata, { intake: { verificationId: 'ver-123' } });
  } finally {
    rmSync(uploadsDir, { recursive: true, force: true });
  }
});

// =============================================================================
// uploadDocumentVersion
// =============================================================================

test('uploadDocumentVersion — adds version to existing document, increments versionNumber', () => {
  clearAll('documents');
  clearAll('document-versions');

  const uploadsDir = mkdtempSync(join(tmpdir(), 'doc-test-'));
  try {
    // Seed a document and first version
    const [, uploadHandler] = createDocumentUploadHandler(uploadsDir, 'http://localhost:1080');
    const uploadReq = makeReq();
    const uploadRes = makeRes();
    uploadHandler(uploadReq, uploadRes);
    const documentId = uploadRes._body.id;

    // Add second version
    const [, versionHandler] = createDocumentVersionUploadHandler(uploadsDir, 'http://localhost:1080');
    const req = makeReq({
      params: { documentId },
      file: { originalname: 'v2.txt', mimetype: 'text/plain', size: 5, buffer: Buffer.from('hello') }
    });
    const res = makeRes();

    versionHandler(req, res);

    assert.strictEqual(res._status, 201);
    assert.strictEqual(res._body.versionNumber, 2);
    assert.strictEqual(res._body.documentId, documentId);

    // Document latestVersionId updated
    const doc = findById('documents', documentId);
    assert.strictEqual(doc.latestVersionId, res._body.id);

    // File on disk
    const filePath = join(uploadsDir, documentId, res._body.id);
    assert.ok(existsSync(filePath));
  } finally {
    rmSync(uploadsDir, { recursive: true, force: true });
  }
});

test('uploadDocumentVersion — returns 404 when document does not exist', () => {
  clearAll('documents');

  const uploadsDir = mkdtempSync(join(tmpdir(), 'doc-test-'));
  try {
    const [, handler] = createDocumentVersionUploadHandler(uploadsDir, 'http://localhost:1080');
    const req = makeReq({ params: { documentId: '00000000-0000-0000-0000-000000000000' } });
    const res = makeRes();

    handler(req, res);

    assert.strictEqual(res._status, 404);
  } finally {
    rmSync(uploadsDir, { recursive: true, force: true });
  }
});

// =============================================================================
// getDocumentVersionContent
// =============================================================================

test('getDocumentVersionContent — sets Content-Type and Content-Disposition headers', (t, done) => {
  clearAll('documents');
  clearAll('document-versions');

  const uploadsDir = mkdtempSync(join(tmpdir(), 'doc-test-'));

  // Upload a document to seed DB and disk
  const [, uploadHandler] = createDocumentUploadHandler(uploadsDir, 'http://localhost:1080');
  const uploadReq = makeReq();
  const uploadRes = makeRes();
  uploadHandler(uploadReq, uploadRes);
  const versionId = uploadRes._body.latestVersionId;

  // Use a PassThrough as the response so the ReadStream can pipe into it
  const res = new PassThrough();
  res._headers = {};
  res.setHeader = (k, v) => { res._headers[k] = v; };

  const contentHandler = createDocumentContentHandler(uploadsDir);
  contentHandler({ params: { documentVersionId: versionId } }, res);

  res.on('finish', () => {
    try {
      assert.strictEqual(res._headers['Content-Type'], 'text/plain');
      assert.ok(res._headers['Content-Disposition']?.includes('test.txt'));
      rmSync(uploadsDir, { recursive: true, force: true });
      done();
    } catch (err) {
      rmSync(uploadsDir, { recursive: true, force: true });
      done(err);
    }
  });
});

test('getDocumentVersionContent — returns 404 when version does not exist', () => {
  clearAll('document-versions');

  const uploadsDir = mkdtempSync(join(tmpdir(), 'doc-test-'));
  try {
    const handler = createDocumentContentHandler(uploadsDir);
    const req = { params: { documentVersionId: '00000000-0000-0000-0000-000000000000' } };
    const res = makeRes();

    handler(req, res);

    assert.strictEqual(res._status, 404);
  } finally {
    rmSync(uploadsDir, { recursive: true, force: true });
  }
});

test('getDocumentVersionContent — returns 404 when file is missing from disk', () => {
  clearAll('documents');
  clearAll('document-versions');

  const uploadsDir = mkdtempSync(join(tmpdir(), 'doc-test-'));
  try {
    // Insert a version record with no corresponding file on disk
    const versionId = '11111111-1111-4111-8111-111111111111';
    insertResource('document-versions', {
      id: versionId,
      documentId: '22222222-2222-4222-8222-222222222222',
      versionNumber: 1,
      fileName: 'ghost.txt',
      mimeType: 'text/plain',
      sizeBytes: 0,
      contentHash: 'abc',
      uploadedById: 'user-1',
      createdAt: new Date().toISOString()
    });

    const handler = createDocumentContentHandler(uploadsDir);
    const req = { params: { documentVersionId: versionId } };
    const res = makeRes();

    handler(req, res);

    assert.strictEqual(res._status, 404);
    assert.strictEqual(res._body.message, 'File content not available');
  } finally {
    rmSync(uploadsDir, { recursive: true, force: true });
  }
});
