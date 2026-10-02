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
  for (const api of apiSpecs) {
    if (!api.relativePath) continue;
    for (const name of Object.keys(api.schemas ?? {})) {
      if (!declaredIn.has(name)) declaredIn.set(name, api.relativePath);
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

      for (const { instancePath, message } of errorsFrom(validateFn, value)) {
        errors.push({ api: apiName, key, message: `${instancePath || '/'}: ${message}` });
      }
    }
  }

  return errors;
}
