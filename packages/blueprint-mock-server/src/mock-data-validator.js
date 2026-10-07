/**
 * Mock data validator — validates *-mock-data.yaml records against API schemas.
 */

import { extract } from '@codeforamerica/blueprint-core';
import { errorsFrom } from './example-validator.js';
import { createAjv, registerDocuments, validatorFor } from './schema-registry.js';

/**
 * The mock-data documents in a set, with the API each is named after.
 *
 * Reads them out of `docs` rather than walking the tree for
 * `*-mock-data.yaml`. The documents are already loaded and parsed — walking
 * again read the same files a second time, and meant this could not run at
 * all against a contracts artifact, which has documents but no directory
 * (#448).
 *
 * @param {import('@codeforamerica/blueprint-core').Doc[]} docs
 * @returns {{ apiName: string, examples: object }[]}
 */
function mockDataDocuments(docs) {
  return docs
    .filter((doc) => doc.type === 'mock-data')
    .map((doc) => ({
      // The filename names the API, as it always did: intake-mock-data.yaml
      // is intake's. Taken from relativePath so it is the same answer whether
      // the document came off disk or out of an artifact.
      apiName: (doc.relativePath ?? doc.path).split('/').pop().replace(/-mock-data\.yaml$/, ''),
      examples: doc.content ?? {},
    }));
}

/**
 * The properties of a schema that are computed at read time.
 *
 * A seed record is what is *stored*, and an `x-derived` field is never stored
 * — it is evaluated when the record is read. So the record cannot carry one,
 * and the read schema requiring it does not mean the seed is wrong.
 *
 * Walks `allOf` because a read schema is usually a writable base plus the
 * server-managed fields, and the derived ones are in that second branch.
 * `$ref`s are not followed: a derived field is readOnly, so it is declared on
 * the read schema rather than on anything the writable base points at.
 *
 * @param {object} schema
 * @returns {Set<string>}
 */
function derivedProperties(schema) {
  const names = new Set();

  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    for (const [name, property] of Object.entries(node.properties ?? {})) {
      if (property && typeof property === 'object' && 'x-derived' in property) names.add(name);
    }
    for (const branch of node.allOf ?? []) walk(branch);
  };

  walk(schema);
  return names;
}

/**
 * Check every seeded record against the schema it claims to exemplify.
 *
 * @param {import('@codeforamerica/blueprint-core').Doc[]} docs - The contract set
 * @param {object[]} apiSpecs - From `apiSpecsFromDocs`
 * @returns {{ api: string, key: string|null, message: string }[]}
 */
export function validateMockData(docs, apiSpecs) {
  const errors = [];

  // Where each schema is declared, rather than the schema object. A record is
  // checked by resolving a validator at that pointer, which is what lets ajv
  // follow a cross-file $ref out of it — a detached schema object carries no
  // base to resolve one against (#448).
  const declaredIn = new Map();
  const derivedIn = new Map();
  for (const api of apiSpecs) {
    if (!api.relativePath) continue;
    for (const [name, schema] of Object.entries(api.schemas ?? {})) {
      if (declaredIn.has(name)) continue;
      declaredIn.set(name, api.relativePath);
      derivedIn.set(name, derivedProperties(schema));
    }
  }

  // Core groups each record under the schema it exemplifies, so the schema to
  // check against is the one it was grouped under. Deriving a schema name
  // from the key looked right and was not: records keyed RegistryPolicy* are
  // `Policy`, so the lookup found nothing and skipped validation in silence.
  const ajv = createAjv();
  registerDocuments(ajv, docs);

  const schemaOf = new Map();
  for (const [schema, records] of Object.entries(extract(docs, 'examples'))) {
    for (const record of records) schemaOf.set(record.key, schema);
  }

  for (const { apiName, examples } of mockDataDocuments(docs)) {

    for (const [key, value] of Object.entries(examples)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;

      // Matching no schema is the dangerous case: the record conforms to
      // nothing, is seeded nowhere, and nothing says so. A platform event
      // keyed DomainEventExample1 survived that way while the schema is
      // `Event`.
      const schemaName = schemaOf.get(key);
      if (!schemaName) {
        errors.push({
          api: apiName,
          key,
          message: 'matches no schema in the contract set, so it is seeded nowhere. '
            + 'Name the key after the schema it is an example of.',
        });
        continue;
      }

      const relativePath = declaredIn.get(schemaName);
      if (!relativePath) continue;

      const validateFn = validatorFor(ajv, relativePath, `/components/schemas/${schemaName}`);
      if (!validateFn) continue;

      const derived = derivedIn.get(schemaName) ?? new Set();

      for (const { instancePath, message, missingProperty } of errorsFrom(validateFn, value)) {
        // The seed is input; a derived field is output. Requiring one of a
        // record that stores it nowhere fails every seed in the set, which is
        // how the Node server stopped booting on this contract set at all.
        if (missingProperty && derived.has(missingProperty)) continue;

        errors.push({ api: apiName, key, message: `${instancePath || '/'}: ${message}` });
      }
    }
  }

  return errors;
}
