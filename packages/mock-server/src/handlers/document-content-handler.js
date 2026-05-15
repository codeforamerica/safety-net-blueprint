/**
 * Handler for GET /document-versions/{id}/content (getDocumentVersionContent).
 * Streams the file bytes for a document version from disk.
 */

import { createReadStream, existsSync } from 'fs';
import { join } from 'path';
import { findById } from '../database-manager.js';

/**
 * Create handler for GET /document-versions/{documentVersionId}/content.
 *
 * @param {string} uploadsDir - Directory where uploaded files are stored
 * @returns {Function} Express handler
 */
export function createDocumentContentHandler(uploadsDir) {
  return (req, res) => {
    const { documentVersionId } = req.params;

    const version = findById('document-versions', documentVersionId);
    if (!version) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Document version not found' });
    }

    const filePath = join(uploadsDir, version.documentId, version.id);
    if (!existsSync(filePath)) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'File content not available' });
    }

    res.setHeader('Content-Type', version.mimeType || 'application/octet-stream');
    if (version.fileName) {
      res.setHeader('Content-Disposition', `attachment; filename="${version.fileName}"`);
    }

    createReadStream(filePath).pipe(res);
  };
}
