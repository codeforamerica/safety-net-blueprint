/**
 * Collect named string enum $defs from external schema files referenced by an OpenAPI spec.
 *
 * hey-api inlines external $refs when generating clients, so enum types defined in shared
 * schema files (e.g. common/schemas/income.yaml) are never seen as named schemas — they get
 * inlined as anonymous union types. This module collects those enums so the client generator
 * can append explicit const exports, making them iterable at runtime.
 *
 * Uses loadContractFiles + loadExternalRefs from blueprint-core so any valid relative path
 * pattern is handled correctly, regardless of directory depth.
 */

import { loadExternalRefs } from '@codeforamerica/blueprint-core';
import { readFileSync } from 'fs';
import { resolve as resolvePath } from 'path';
import yaml from 'js-yaml';

/**
 * Collect named string enum $defs from external schema files referenced by a spec.
 *
 * @param {string} specPath - Absolute path to the OpenAPI spec file
 * @param {Map<string, {content: object, type: string, relativePath: string}>} fileMap
 *   The map returned by loadContractFiles for the resolved contracts directory.
 *   Used to resolve external $ref paths without re-reading from disk.
 * @returns {{ name: string, values: string[] }[]}
 */
export function collectNamedEnumDefs(specPath, fileMap) {
  let rawSpec;
  try {
    rawSpec = yaml.load(readFileSync(resolvePath(specPath), 'utf8'));
  } catch {
    return [];
  }

  const externalRefs = loadExternalRefs(specPath, rawSpec, fileMap);

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
