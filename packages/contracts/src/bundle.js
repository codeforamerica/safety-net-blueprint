/**
 * Bundle an OpenAPI spec by inlining all external $ref references.
 *
 * @param {string} specPath - Absolute path to the YAML spec file
 * @returns {Promise<Object>} The dereferenced spec object with all $refs inlined
 */
import $RefParser from '@apidevtools/json-schema-ref-parser';

export async function bundleSpec(specPath) {
  return $RefParser.dereference(specPath, {
    dereference: { circular: 'ignore' }
  });
}
