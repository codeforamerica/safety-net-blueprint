/**
 * Bundle an OpenAPI spec by inlining all external $ref references.
 *
 * Canonical `https://blueprint.codeforamerica.org/...` refs are identifiers,
 * not addresses — nothing is served there. They are read from disk: `base/`
 * from the resolved set's own copy, so its overlays apply, and `schemas/` from
 * the blueprint's schema directory. A config schema's `allOf` names the
 * generic config schema that way.
 *
 * @param {string} specPath - Absolute path to the YAML spec file
 * @param {Object} [options]
 * @param {string} [options.setDir] - The resolved set the spec belongs to; `base/` is read from there
 * @returns {Promise<Object>} The dereferenced spec object with all $refs inlined
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import $RefParser from '@apidevtools/json-schema-ref-parser';
import { schemasDir, baseContractsDir } from '@codeforamerica/blueprint-core';

const CANONICAL = 'https://blueprint.codeforamerica.org/';

export async function bundleSpec(specPath, { setDir } = {}) {
  const local = (url) => {
    const rest = url.slice(CANONICAL.length).split('#')[0];
    if (rest.startsWith('schemas/')) return join(schemasDir, rest.slice('schemas/'.length));
    if (rest.startsWith('base/')) return join(setDir ? join(setDir, 'base') : baseContractsDir, rest.slice('base/'.length));
    return null;
  };
  return $RefParser.dereference(specPath, {
    dereference: { circular: 'ignore' },
    resolve: {
      canonical: {
        order: 1,
        canRead: (file) => file.url.startsWith(CANONICAL) && local(file.url) !== null,
        read: (file) => readFileSync(local(file.url), 'utf8'),
      },
    },
  });
}
