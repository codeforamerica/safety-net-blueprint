/**
 * Handler for GET /document-versions/{id}/content (getDocumentVersionContent).
 *
 * The mock stores document metadata and never the bytes (#448 step 5), so this
 * returns a JSON object describing what was uploaded — name, type, size, hash,
 * upload time — rather than the file.
 *
 * The contract declares this response as `application/octet-stream`, so it
 * never promised a PDF; opaque bytes are what it asks for and JSON is a valid
 * instance of that. The response is sent as `application/json` rather than
 * echoing the recorded MIME type, because claiming `application/pdf` over a
 * JSON body is the one option a client would actually be misled by.
 */

import { assertFetchShaped } from '../http/request.js';

/**
 * Create handler for GET /document-versions/{documentVersionId}/content.
 *
 * @returns {(request: Request, ctx: object) => Response}
 */
export function createDocumentContentHandler({ store } = {}) {
  return (request, { params }) => {
    assertFetchShaped(request, 'createDocumentContentHandler');
    const { documentVersionId } = params;

    const version = store.findById('document-versions', documentVersionId);
    if (!version) {
      return Response.json({ code: 'NOT_FOUND', message: 'Document version not found' }, { status: 404 });
    }

    const placeholder = {
      placeholder: true,
      message: 'The mock server stores document metadata only, never file bytes.',
      documentId: version.documentId,
      documentVersionId: version.id,
      versionNumber: version.versionNumber,
      fileName: version.fileName,
      mimeType: version.mimeType,
      sizeBytes: version.sizeBytes,
      contentHash: version.contentHash,
      uploadedById: version.uploadedById,
      uploadedAt: version.createdAt,
    };

    // The recorded file name is suffixed so a saved file is not a `.pdf` that
    // will not open.
    const disposition = version.fileName
      ? `attachment; filename="${version.fileName}.placeholder.json"`
      : 'attachment; filename="placeholder.json"';

    return Response.json(placeholder, { headers: { 'Content-Disposition': disposition } });
  };
}
