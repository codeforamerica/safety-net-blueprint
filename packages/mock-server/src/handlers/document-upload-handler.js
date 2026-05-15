/**
 * Handler for document upload endpoints.
 *
 * Handles two operationIds:
 *   uploadDocument         — POST /documents (create document + first version atomically)
 *   uploadDocumentVersion  — POST /documents/{documentId}/document-versions (add version)
 *
 * Files are stored at {uploadsDir}/{documentId}/{versionId}.
 * MIME type is preserved on the version record; no file extension is stored on disk.
 */

import multer from 'multer';
import { createHash, randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { insertResource, findById, findAll, update } from '../database-manager.js';
import { emitEvent } from '../emit-event.js';

const upload = multer({ storage: multer.memoryStorage() });

/**
 * Resolve the uploads directory from env or default.
 * @param {string} [defaultDir] - Fallback path (typically {mockServerRoot}/uploads)
 * @returns {string}
 */
export function resolveUploadsDir(defaultDir) {
  return process.env.MOCK_UPLOADS_DIR || defaultDir;
}

/**
 * Create handler for POST /documents (uploadDocument).
 * Parses multipart/form-data, creates document + first version atomically.
 *
 * @param {string} uploadsDir - Directory to store uploaded files
 * @param {string} baseUrl - Base URL for Location header
 * @returns {Array} [multerMiddleware, expressHandler]
 */
export function createDocumentUploadHandler(uploadsDir, baseUrl) {
  const middleware = upload.single('file');

  const handler = (req, res) => {
    if (!req.file) {
      return res.status(422).json({
        code: 'VALIDATION_ERROR',
        message: 'Missing required field: file',
        details: [{ field: 'file', message: 'required' }]
      });
    }

    const { documentTypeId, title, documentDate, metadata } = req.body;

    if (!documentTypeId) {
      return res.status(422).json({
        code: 'VALIDATION_ERROR',
        message: 'Missing required field: documentTypeId',
        details: [{ field: 'documentTypeId', message: 'required' }]
      });
    }

    if (!title) {
      return res.status(422).json({
        code: 'VALIDATION_ERROR',
        message: 'Missing required field: title',
        details: [{ field: 'title', message: 'required' }]
      });
    }

    const documentId = randomUUID();
    const versionId = randomUUID();
    const now = new Date().toISOString();

    // Persist file bytes to disk
    const docDir = join(uploadsDir, documentId);
    mkdirSync(docDir, { recursive: true });
    writeFileSync(join(docDir, versionId), req.file.buffer);

    // Parse optional metadata JSON string
    let parsedMetadata = {};
    if (metadata) {
      try {
        parsedMetadata = JSON.parse(metadata);
      } catch {
        return res.status(400).json({
          code: 'BAD_REQUEST',
          message: 'Invalid JSON in metadata field',
          details: [{ field: 'metadata', message: 'must be valid JSON' }]
        });
      }
    }

    const contentHash = createHash('sha256').update(req.file.buffer).digest('hex');

    const version = {
      id: versionId,
      documentId,
      versionNumber: 1,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      contentHash,
      uploadedById: req.headers['x-caller-id'] || 'anonymous',
      createdAt: now
    };
    insertResource('document-versions', version);

    const document = {
      id: documentId,
      documentTypeId,
      title,
      documentDate: documentDate || null,
      lifecycleState: 'active',
      legalHold: false,
      latestVersionId: versionId,
      retentionDeadline: null,
      metadata: parsedMetadata,
      dispositionApprovedBy: null,
      dispositionApprovedAt: null,
      createdAt: now,
      updatedAt: now
    };
    insertResource('documents', document);

    emitEvent({ domain: 'document-management', object: 'document', action: 'created', resourceId: document.id, source: '/document-management', data: { documentId, latestVersionId: versionId } });

    res.status(201)
      .set('Location', `${baseUrl}/document-management/documents/${documentId}`)
      .json(document);
  };

  return [middleware, handler];
}

/**
 * Create handler for POST /documents/{documentId}/document-versions (uploadDocumentVersion).
 * Adds a new version to an existing document.
 *
 * @param {string} uploadsDir - Directory to store uploaded files
 * @param {string} baseUrl - Base URL for Location header
 * @returns {Array} [multerMiddleware, expressHandler]
 */
export function createDocumentVersionUploadHandler(uploadsDir, baseUrl) {
  const middleware = upload.single('file');

  const handler = (req, res) => {
    const { documentId } = req.params;

    const document = findById('documents', documentId);
    if (!document) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Document not found' });
    }

    if (!req.file) {
      return res.status(422).json({
        code: 'VALIDATION_ERROR',
        message: 'Missing required field: file',
        details: [{ field: 'file', message: 'required' }]
      });
    }

    const { items: existingVersions } = findAll('document-versions', { documentId }, { limit: 1000 });
    const versionNumber = existingVersions.length + 1;
    const versionId = randomUUID();
    const now = new Date().toISOString();

    // Persist file bytes to disk
    const docDir = join(uploadsDir, documentId);
    mkdirSync(docDir, { recursive: true });
    writeFileSync(join(docDir, versionId), req.file.buffer);

    const contentHash = createHash('sha256').update(req.file.buffer).digest('hex');

    const version = {
      id: versionId,
      documentId,
      versionNumber,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      contentHash,
      uploadedById: req.headers['x-caller-id'] || 'anonymous',
      createdAt: now
    };
    insertResource('document-versions', version);

    update('documents', documentId, { latestVersionId: versionId, updatedAt: now });

    emitEvent({ domain: 'document-management', object: 'document-version', action: 'uploaded', resourceId: versionId, source: '/document-management', data: { documentId, versionId, versionNumber } });

    res.status(201)
      .set('Location', `${baseUrl}/document-management/document-versions/${versionId}`)
      .json(version);
  };

  return [middleware, handler];
}
