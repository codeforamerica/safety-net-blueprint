/**
 * Handler for document upload endpoints.
 *
 * Handles two operationIds:
 *   uploadDocument         — POST /documents (create document + first version atomically)
 *   uploadDocumentVersion  — POST /documents/{documentId}/document-versions (add version)
 *
 * **No file bytes are stored.** A version records what was uploaded — file name,
 * MIME type, size, and a hash of the content — and nothing else. The bytes are
 * hashed in flight and discarded (#448 step 5).
 *
 * That is a deliberate constraint rather than a simplification. Anything the
 * mock holds can end up in a `snapshot()`, and a snapshot is made to be shared;
 * a real uploaded paystub in a fixture is a PII leak waiting to be emailed.
 * Not storing bytes makes that impossible rather than discouraged, and it keeps
 * the store serializable and bounded.
 *
 * Multipart is parsed with `request.formData()`, which is why `multer` is gone.
 */

import { emitEvent } from '../emit-event.js';
import { assertFetchShaped } from '../http/request.js';
import { callerHeader } from '../auth-context.js';

/**
 * Pull the uploaded file out of a multipart body.
 *
 * @param {Request} request
 * @returns {Promise<{ file: File|null, fields: Record<string,string> }>}
 */
async function readUpload(request) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return { file: null, fields: {} };
  }

  const fields = {};
  let file = null;
  for (const [name, value] of form) {
    if (name === 'file' && typeof value === 'object' && value !== null) file = value;
    else if (typeof value === 'string') fields[name] = value;
  }
  return { file, fields };
}

/**
 * Describe an uploaded file without keeping it.
 *
 * @param {File} file
 * @returns {Promise<{ fileName: string, mimeType: string, sizeBytes: number, contentHash: string }>}
 */
async function describe(file) {
  const bytes = await file.arrayBuffer();
  // Web Crypto rather than node:crypto — `crypto.subtle.digest` produces the
  // identical SHA-256 and exists in browsers, where `createHash` does not.
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return {
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: bytes.byteLength,
    contentHash: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join(''),
  };
}

const missingField = (field) => Response.json({
  code: 'VALIDATION_ERROR',
  message: `Missing required field: ${field}`,
  details: [{ field, message: 'required' }],
}, { status: 422 });

/**
 * Create handler for POST /documents (uploadDocument).
 *
 * @param {string} baseUrl - Base URL for Location header
 * @returns {(request: Request) => Promise<Response>}
 */
export function createDocumentUploadHandler(baseUrl, { store } = {}) {
  return async (request) => {
    const { file, fields } = await readUpload(assertFetchShaped(request, 'createDocumentUploadHandler'));
    if (!file) return missingField('file');

    const { documentTypeId, title, documentDate, metadata } = fields;
    if (!documentTypeId) return missingField('documentTypeId');
    if (!title) return missingField('title');

    // Parse optional metadata JSON string
    let parsedMetadata = {};
    if (metadata) {
      try {
        parsedMetadata = JSON.parse(metadata);
      } catch {
        return Response.json({
          code: 'BAD_REQUEST',
          message: 'Invalid JSON in metadata field',
          details: [{ field: 'metadata', message: 'must be valid JSON' }],
        }, { status: 400 });
      }
    }

    const documentId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const now = new Date().toISOString();

    const version = {
      id: versionId,
      documentId,
      versionNumber: 1,
      ...(await describe(file)),
      uploadedById: callerHeader(request, 'x-caller-id') ?? 'anonymous',
      createdAt: now,
    };
    store.insertResource('document-versions', version);

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
      updatedAt: now,
    };
    store.insertResource('documents', document);

    emitEvent({
      store, domain: 'document-management', object: 'document', action: 'created',
      resourceId: document.id, source: '/document-management',
      data: { documentId, latestVersionId: versionId },
    });

    return Response.json(document, {
      status: 201,
      headers: { Location: `${baseUrl}/document-management/documents/${documentId}` },
    });
  };
}

/**
 * Create handler for POST /documents/{documentId}/document-versions.
 *
 * @param {string} baseUrl - Base URL for Location header
 * @returns {(request: Request, ctx: object) => Promise<Response>}
 */
export function createDocumentVersionUploadHandler(baseUrl, { store } = {}) {
  return async (request, { params }) => {
    const { documentId } = params;

    const document = store.findById('documents', documentId);
    if (!document) {
      return Response.json({ code: 'NOT_FOUND', message: 'Document not found' }, { status: 404 });
    }

    const { file } = await readUpload(assertFetchShaped(request, 'createDocumentVersionUploadHandler'));
    if (!file) return missingField('file');

    const { items: existingVersions } = store.findAll('document-versions', { documentId }, { limit: 1000 });
    const versionNumber = existingVersions.length + 1;
    const versionId = crypto.randomUUID();
    const now = new Date().toISOString();

    const version = {
      id: versionId,
      documentId,
      versionNumber,
      ...(await describe(file)),
      uploadedById: callerHeader(request, 'x-caller-id') ?? 'anonymous',
      createdAt: now,
    };
    store.insertResource('document-versions', version);
    store.update('documents', documentId, { latestVersionId: versionId, updatedAt: now });

    emitEvent({
      store, domain: 'document-management', object: 'document-version', action: 'uploaded',
      resourceId: versionId, source: '/document-management',
      data: { documentId, versionId, versionNumber },
    });

    return Response.json(version, {
      status: 201,
      headers: { Location: `${baseUrl}/document-management/document-versions/${versionId}` },
    });
  };
}
