/**
 * General-purpose contract validator.
 *
 * Detects the type of a parsed contract document and dispatches to the
 * appropriate type-specific validator. Returns errors in the same shape
 * across all types: { rule, message, path }.
 *
 * Schema correctness (required fields, types, patterns) is handled upstream
 * by JSON Schema validation via each file's $schema declaration.
 */

import { detectType } from './contract-files.js';
import { validateRulesDoc } from './rules-validator.js';

/**
 * Validate a contract document, detecting its type from $schema and filename.
 *
 * @param {Object} doc        - parsed YAML document
 * @param {string} [filename] - filename for fallback type detection
 * @returns {{ rule: string, message: string, path: string }[]}
 */
export function validateContract(doc, filename = '') {
  const type = detectType(filename, doc);

  if (type === 'rules') return validateRulesDoc(doc);

  return [];
}
