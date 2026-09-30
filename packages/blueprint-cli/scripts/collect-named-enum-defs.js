/**
 * Collect named string enum $defs from external schema files referenced by an OpenAPI spec.
 *
 * hey-api inlines external $refs when generating clients, so enum types defined in shared
 * schema files (e.g. common/schemas/income.yaml) are never seen as named schemas — they get
 * inlined as anonymous union types. This module collects those enums so the client generator
 * can append explicit const exports, making them iterable at runtime.
 *
 * Resolves refs through the loaded contract set so any valid relative path
 * pattern is handled correctly, regardless of directory depth.
 */

import { load } from '@codeforamerica/blueprint-core';
import { resolve as resolvePath } from 'path';

/**
 * Collect named string enum $defs from external schema files referenced by a spec.
 *
 * @param {string} specPath - Absolute path to the OpenAPI spec file
 * @param {import('@codeforamerica/blueprint-core').Doc[]} docs - The contract
 *   set, used to resolve the spec's external $refs without re-reading disk.
 * @returns {{ name: string, values: string[] }[]}
 */
export function collectNamedEnumDefs(specPath, docs) {
  let doc;
  try {
    doc = load({ path: resolvePath(specPath) });
  } catch {
    return [];
  }

  const externalRefs = doc.externalRefs(docs);

  const seen = new Set();
  const namedEnums = [];

  for (const content of externalRefs.values()) {
    const defs = content?.$defs ?? content?.definitions ?? {};
    for (const [defName, def] of Object.entries(defs)) {
      if (def.type === 'string' && Array.isArray(def.enum)) {
        if (!seen.has(defName)) {
          seen.add(defName);
          namedEnums.push({ name: defName, values: def.enum });
        }
      }
    }
  }

  return namedEnums;
}
