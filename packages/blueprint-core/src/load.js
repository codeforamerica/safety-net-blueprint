/**
 * Parse one contract file into a Doc.
 *
 * A Doc keeps the parsed document in its native shape under `content` — what
 * was read is what gets written back. Two derived views hang off it, both
 * methods rather than fields:
 *
 *   refs()   an index of every $ref in the document
 *   model()  a normalized view of blueprint-authored types, null otherwise
 *
 * They are computed from `this.content` on every call, which is what makes
 * them safe. A resolve pass produces its next document with `{...doc, content}`,
 * and spread copies these methods but not any value they had already produced
 * — so the derived view always reflects the content it is asked about. Stored
 * as fields they went stale the moment a pass rewrote `content`, and validate
 * silently checked pre-resolution documents.
 *
 * For the same reason these must stay object-literal methods. Spread copies
 * own enumerable properties only, so a class prototype method would vanish on
 * the first pass, and an arrow closing over `content` would capture the value
 * at load time and never update.
 *
 * Standards-defined documents (OpenAPI, AsyncAPI, JSON Schema) are left in
 * their standard shape — every downstream tool already speaks it, and a
 * parallel representation would only need converting back.
 */

import { readFileSync } from 'fs';
import { basename } from 'path';
import yaml from 'js-yaml';
import { detectType } from './contract-types.js';
import { toDoc } from './doc.js';

/**
 * Read a contract file and build its Doc.
 *
 * Takes what `discover` returned rather than its parts: `path`, `relativePath`
 * and `domain` are one thing — the file's identity within the set — so
 * `discover(dir).map(load)` carries all of it through. A bare path is accepted
 * for a file that belongs to no set; `relativePath` is then null, and
 * `generate` rejects such a document rather than guessing at a root.
 *
 * @param {import('../types.js').DiscoveredFile|string} file - What `discover`
 *   returned, or a bare path for a file that belongs to no set
 * @returns {import('../types.js').Doc}
 */
export function load(file) {
  const { path, relativePath = null, domain = null } =
    typeof file === 'string' ? { path: file } : file;

  const raw = readFileSync(path, 'utf8');
  const content = yaml.load(raw, { schema: yaml.CORE_SCHEMA });

  // Reading is this function's whole job; building the Doc belongs to doc.js,
  // which an artifact can reach without a filesystem.
  return toDoc({
    path,
    relativePath,
    domain,
    type: detectType(basename(path), content),
    content,
  });
}

