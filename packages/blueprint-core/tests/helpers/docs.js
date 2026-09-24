/**
 * Doc builders for tests.
 *
 * Every resolve pass takes a document set and returns one, so a test needs a
 * Doc rather than a bare spec object. Built the same way `load` builds one —
 * `refs()` and `model()` are methods reading `this.content`, so a pass that
 * returns `{...doc, content}` reports the new content, not the original.
 */

import { detectType } from '../../src/openapi/contract-files.js';

/**
 * @param {object} content - Parsed document content
 * @param {object} [options]
 * @param {string} [options.relativePath] - Position in the contract set
 * @param {string} [options.type] - Overrides content-based detection
 * @param {object} [options.model] - Overrides the derived model
 * @returns {import('../../types.js').Doc}
 */
export function doc(content, { relativePath = 'domains/test/test.yaml', type, model } = {}) {
  const resolvedType = type ?? detectType(relativePath.split('/').pop(), content);

  return {
    path: `/contracts/${relativePath}`,
    relativePath,
    type: resolvedType,
    content,
    refs() { return new Map(); },
    model() { return model ?? null; },
    resolved: false,
    provenance: null,
  };
}

/**
 * The content of each doc in a pass result, in order.
 *
 * @param {{ docs: object[] }} result
 * @returns {object[]}
 */
export function contents(result) {
  return result.docs.map((d) => d.content);
}

/**
 * The single document's content, for passes exercised with one doc.
 *
 * @param {{ docs: object[] }} result
 * @returns {object}
 */
export function only(result) {
  return result.docs[0].content;
}
